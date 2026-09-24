// Aunty Acid Comics App - auntyacidapp.pages.dev

// Service Worker Registration
if ('serviceWorker' in navigator) {
	window.addEventListener('load', () => {
		navigator.serviceWorker.register('./sw.js', { scope: './' })
			.catch(() => {});
	});
}

const Core = window.AuntyAcidCore;

const START_DATE = Core.parseYmd('2013-05-06');
const CORS_PROXY = 'https://corsproxy.garfieldapp.workers.dev/cors-proxy?';
const IMAGE_URL_CACHE_KEY = 'imageUrls';
const IMAGE_URL_CACHE_LIMIT = 500;
const MAX_SAME_IMAGE_SKIPS = 7;

// Date the user asked for (drives navigation and the date picker while a load is pending)
let selectedDate = null;
// Date whose comic is currently on screen (drives favorites, sharing and lastcomic)
let displayedDate = null;
let pictureUrl = '';
let loadSequence = 0;
let deferredPrompt = null;
let notificationTimer = null;

// Helper functions
const $ = (id) => document.getElementById(id);
const todayDate = () => Core.startOfDay(new Date());
const getFavs = () => Core.sanitizeFavorites(Core.safeJsonParse(localStorage.getItem('favs'), []), START_DATE, null).favorites;
const setFavs = (favs) => localStorage.setItem('favs', JSON.stringify(favs));
const isFavoritesMode = () => !!$('showfavs')?.checked;

class ComicLoadError extends Error {
	constructor(kind, status) {
		super(kind);
		this.kind = kind; // 'offline' | 'http' | 'no-image' | 'image' | 'network'
		this.status = status;
	}
}

// ========================================
// COMIC IMAGE URL LOOKUP (cached + deduplicated)
// ========================================

// Comic asset URLs never change for a date, so they are cached (and persisted for offline use).
const imageUrlCache = new Map(Object.entries(Core.safeJsonParse(localStorage.getItem(IMAGE_URL_CACHE_KEY), {}))
	.filter(([date, url]) => Core.isValidFavorite(date) && Core.isComicImageUrl(url)));
const inflightLookups = new Map();

function persistImageUrls() {
	// Today's page may still change (late publishing), so it is only cached in memory.
	const persistable = [...imageUrlCache].filter(([date]) => date !== Core.toYmd(todayDate()));
	try {
		localStorage.setItem(IMAGE_URL_CACHE_KEY, JSON.stringify(Object.fromEntries(persistable)));
	} catch {
		// Storage full - the in-memory cache still works
	}
}

function rememberImageUrl(ymd, url) {
	imageUrlCache.delete(ymd);
	imageUrlCache.set(ymd, url);
	while (imageUrlCache.size > IMAGE_URL_CACHE_LIMIT) {
		imageUrlCache.delete(imageUrlCache.keys().next().value);
	}
	persistImageUrls();
}

function forgetImageUrl(ymd) {
	if (imageUrlCache.delete(ymd)) persistImageUrls();
}

function getComicImageUrl(ymd) {
	if (imageUrlCache.has(ymd)) return Promise.resolve(imageUrlCache.get(ymd));
	if (inflightLookups.has(ymd)) return inflightLookups.get(ymd);

	const lookup = fetch(`${CORS_PROXY}https://www.gocomics.com/aunty-acid/${ymd}`)
		.catch(() => {
			throw new ComicLoadError(navigator.onLine === false ? 'offline' : 'network');
		})
		.then(response => {
			if (!response.ok) throw new ComicLoadError('http', response.status);
			return response.text();
		})
		.then(html => {
			const url = Core.extractComicImageUrl(html);
			if (!url) throw new ComicLoadError('no-image');
			rememberImageUrl(ymd, url);
			return url;
		})
		.finally(() => inflightLookups.delete(ymd));

	inflightLookups.set(ymd, lookup);
	return lookup;
}

function applyImageSource(img, url) {
	// featureassets serves CORS headers; loading in CORS mode lets the SW cache real (non-opaque)
	// responses and lets sharing read the pixels.
	if (url.startsWith('https://featureassets.gocomics.com/')) {
		img.crossOrigin = 'anonymous';
	} else {
		img.removeAttribute('crossorigin');
	}
	img.src = url;
}

// Resolves once the image is decodable (from network, HTTP cache or the SW image cache)
function loadImage(url) {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(url);
		img.onerror = () => reject(new ComicLoadError(navigator.onLine === false ? 'offline' : 'image'));
		applyImageSource(img, url);
	});
}

function preloadComic(date) {
	getComicImageUrl(Core.toYmd(date))
		.then(url => applyImageSource(new Image(), url))
		.catch(() => {});
}

function preloadAdjacentComics(date) {
	const previous = Core.addDays(date, -1);
	const next = Core.addDays(date, 1);
	if (previous >= START_DATE) preloadComic(previous);
	if (next <= todayDate()) preloadComic(next);
}

// ========================================
// UI HELPERS
// ========================================

function formatLongDate(date) {
	return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function updateFavIcon(isFavorite) {
	document.querySelector('.favicon')?.setAttribute('fill', isFavorite ? 'currentColor' : 'none');
	const favButton = $('favheart');
	if (favButton) {
		favButton.setAttribute('aria-pressed', String(isFavorite));
		favButton.setAttribute('aria-label', isFavorite ? 'Remove from favorites' : 'Add to favorites');
	}
}

// Notification Toast System
function showNotification(message, duration = 3000, action = null) {
	const toast = $('notificationToast');
	const content = $('notificationContent');
	const actionButton = $('notificationAction');
	if (!toast) return;
	if (content) content.textContent = message;

	if (actionButton) {
		actionButton.hidden = !action;
		actionButton.onclick = null;
		if (action) {
			actionButton.textContent = action.label;
			actionButton.onclick = () => {
				hideNotification();
				action.handler();
			};
		}
	}

	toast.classList.add('show');
	clearTimeout(notificationTimer);
	if (duration > 0) {
		notificationTimer = setTimeout(hideNotification, duration);
	}
}

function hideNotification() {
	clearTimeout(notificationTimer);
	$('notificationToast')?.classList.remove('show');
}

// Settings Panel
function toggleSettings() {
	const panel = $('settingsDIV');
	if (panel?.classList.contains('visible')) {
		hideSettings();
	} else {
		showSettings();
	}
}

function showSettings() {
	const panel = $('settingsDIV');
	if (!panel) return;
	panel.classList.add('visible');
	$('settingsBtn')?.setAttribute('aria-expanded', 'true');
	updateExportButtonState();
	$('swipe')?.focus();
}

function hideSettings({ restoreFocus = false } = {}) {
	const panel = $('settingsDIV');
	if (!panel?.classList.contains('visible')) return;
	panel.classList.remove('visible');
	$('settingsBtn')?.setAttribute('aria-expanded', 'false');
	if (restoreFocus) $('settingsBtn')?.focus();
}

// ========================================
// DRAGGABLE TOOLBAR (GarfieldApp pattern)
// ========================================

/**
 * Calculate optimal centered toolbar position between logo and comic
 * @param {HTMLElement} toolbar - Toolbar element
 * @returns {{top: number, left: number}|null} Optimal position or null if not calculable
 */
function calculateOptimalToolbarPosition(toolbar) {
	const header = document.querySelector('.app-header');
	const comic = $('comic');
	if (!header || !comic) return null;
	
	const headerRect = header.getBoundingClientRect();
	const comicRect = comic.getBoundingClientRect();
	const toolbarHeight = toolbar.offsetHeight || toolbar.getBoundingClientRect().height;
	const toolbarWidth = toolbar.offsetWidth || toolbar.getBoundingClientRect().width;
	
	if (!toolbarHeight || !toolbarWidth) return null;
	
	const headerBottom = headerRect.bottom;
	const comicTop = comicRect.top;
	const availableSpace = comicTop - headerBottom;
	
	// Safety check: if available space is too small or negative, place below header
	if (availableSpace < toolbarHeight + 20) {
		const safeTop = headerBottom + 10;
		const left = (window.innerWidth - toolbarWidth) / 2;
		return { top: safeTop, left };
	}
	
	// Calculate centered position between header and comic
	const top = headerBottom + Math.max(10, (availableSpace - toolbarHeight) / 2);
	const left = (window.innerWidth - toolbarWidth) / 2;
	
	// Final safety: ensure we're not overlapping comic
	if (top + toolbarHeight > comicTop - 5) {
		return { top: Math.max(headerBottom + 10, comicTop - toolbarHeight - 10), left };
	}
	
	return { top, left };
}

/**
 * Check if toolbar is within snap zone of optimal position
 */
function isInSnapZone(top, toolbar) {
	const optimal = calculateOptimalToolbarPosition(toolbar);
	if (!optimal) return false;
	const SNAP_THRESHOLD = 25;
	return Math.abs(top - optimal.top) <= SNAP_THRESHOLD;
}

/**
 * Store toolbar position with relative metadata
 */
function storeToolbarPosition(top, left, toolbar) {
	const positionData = { top, left };
	
	// Track position relative to comic
	const comic = $('comic');
	const toolbarRect = toolbar.getBoundingClientRect();
	
	if (comic && toolbarRect.height > 0) {
		const comicRect = comic.getBoundingClientRect();
		const belowComic = toolbarRect.top >= comicRect.bottom;
		positionData.belowComic = belowComic;
		if (belowComic) {
			positionData.offsetFromComic = Math.max(15, toolbarRect.top - comicRect.bottom);
		}
	}
	
	localStorage.setItem('toolbarPos', JSON.stringify(positionData));
}

/**
 * Keep toolbar within viewport bounds and not overlapping logo/comic
 */
function clampToolbarInView() {
	const toolbar = $('mainToolbar');
	if (!toolbar) return;
	
	const isOptimalMode = localStorage.getItem('toolbarOptimal') === 'true';
	
	if (isOptimalMode) {
		// Toolbar is in optimal mode - recalculate centered position
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				const optimalPos = calculateOptimalToolbarPosition(toolbar);
				if (optimalPos) {
					const header = document.querySelector('.app-header');
					const comic = $('comic');
					
					if (header && comic) {
						const headerRect = header.getBoundingClientRect();
						const comicRect = comic.getBoundingClientRect();
						const toolbarHeight = toolbar.offsetHeight;
						
						let safeTop = optimalPos.top;
						
						// Ensure not overlapping header/logo
						if (safeTop < headerRect.bottom + 10) {
							safeTop = headerRect.bottom + 10;
						}
						
						// Ensure not overlapping comic
						if (safeTop + toolbarHeight > comicRect.top - 5) {
							safeTop = Math.max(headerRect.bottom + 10, comicRect.top - toolbarHeight - 10);
						}
						
						toolbar.style.top = safeTop + 'px';
						toolbar.style.left = optimalPos.left + 'px';
						toolbar.style.transform = 'none';
						storeToolbarPosition(safeTop, optimalPos.left, toolbar);
					} else {
						toolbar.style.top = optimalPos.top + 'px';
						toolbar.style.left = optimalPos.left + 'px';
						toolbar.style.transform = 'none';
					}
				}
			});
		});
		return;
	}
	
	// Custom position mode - maintain relative positioning
	const savedPos = Core.safeJsonParse(localStorage.getItem('toolbarPos'), null);
	
	if (!savedPos) {
		// No saved position - center between logo and comic
		positionToolbarCentered(toolbar);
		return;
	}
	
	requestAnimationFrame(() => {
		requestAnimationFrame(() => {
			const rect = toolbar.getBoundingClientRect();
			const toolbarHeight = rect.height;
			const toolbarWidth = toolbar.offsetWidth;
			const viewportWidth = window.innerWidth;
			const viewportHeight = window.innerHeight;
			
			const comic = $('comic');
			const header = document.querySelector('.app-header');
			
			let newTop = savedPos.top;
			let newLeft = (viewportWidth - toolbarWidth) / 2; // Always center horizontally
			
			// If below comic, maintain that relationship
			if (savedPos.belowComic && comic) {
				const comicRect = comic.getBoundingClientRect();
				const storedGap = savedPos.offsetFromComic || 15;
				newTop = comicRect.bottom + storedGap;
			}
			
			// Viewport boundary clamping
			const maxTop = viewportHeight - toolbarHeight - 10;
			if (newTop < 0) newTop = 0;
			if (newTop > maxTop) newTop = maxTop;
			
			// Ensure we don't overlap header/logo
			if (header) {
				const headerRect = header.getBoundingClientRect();
				if (newTop < headerRect.bottom + 10) {
					newTop = headerRect.bottom + 10;
				}
			}
			
			// Ensure we don't overlap comic (unless intentionally below it)
			if (comic && !savedPos.belowComic) {
				const comicRect = comic.getBoundingClientRect();
				if (newTop + toolbarHeight > comicRect.top - 5 && newTop < comicRect.bottom) {
					// Toolbar would overlap comic - push it above
					newTop = Math.max(header ? header.getBoundingClientRect().bottom + 10 : 0, comicRect.top - toolbarHeight - 10);
				}
			}
			
			// Apply position if changed
			const currentTop = parseFloat(toolbar.style.top) || 0;
			const currentLeft = parseFloat(toolbar.style.left) || 0;
			
			if (Math.abs(currentTop - newTop) > 1 || Math.abs(currentLeft - newLeft) > 1) {
				toolbar.style.top = newTop + 'px';
				toolbar.style.left = newLeft + 'px';
				toolbar.style.transform = 'none';
				storeToolbarPosition(newTop, newLeft, toolbar);
			}
		});
	});
}

/**
 * Position toolbar centered between header and comic
 */
function positionToolbarCentered(toolbar, savePosition = false) {
	if (!toolbar || toolbar.offsetHeight === 0) return;
	
	const optimal = calculateOptimalToolbarPosition(toolbar);
	if (!optimal) {
		// Fallback: place below header if we can't compute optimal
		const header = document.querySelector('.app-header');
		if (!header) return;
		const headerRect = header.getBoundingClientRect();
		const toolbarWidth = toolbar.offsetWidth || toolbar.getBoundingClientRect().width;
		const left = (window.innerWidth - toolbarWidth) / 2;
		const top = headerRect.bottom + 10;
		toolbar.style.left = left + 'px';
		toolbar.style.top = top + 'px';
		toolbar.style.transform = 'none';
		if (savePosition) {
			storeToolbarPosition(top, left, toolbar);
		}
		return;
	}
	
	toolbar.style.left = optimal.left + 'px';
	toolbar.style.top = optimal.top + 'px';
	toolbar.style.transform = 'none';
	
	if (savePosition) {
		storeToolbarPosition(optimal.top, optimal.left, toolbar);
		localStorage.setItem('toolbarOptimal', 'true');
	}
}

function initializeToolbar() {
	const toolbar = $('mainToolbar');
	if (!toolbar) return;
	
	// Check for saved position
	const savedPos = Core.safeJsonParse(localStorage.getItem('toolbarPos'), null);
	const isOptimalMode = localStorage.getItem('toolbarOptimal') === 'true';
	
	if (savedPos && typeof savedPos.top === 'number') {
		if (isOptimalMode) {
			// Toolbar was in optimal mode - recalculate optimal position on load
			const tryOptimalPosition = () => {
				const optimalPos = calculateOptimalToolbarPosition(toolbar);
				if (optimalPos) {
					toolbar.style.top = optimalPos.top + 'px';
					toolbar.style.left = optimalPos.left + 'px';
					toolbar.style.transform = 'none';
				}
			};
			
			// Try immediately and after load
			setTimeout(tryOptimalPosition, 0);
			setTimeout(tryOptimalPosition, 50);
			window.addEventListener('load', () => {
				setTimeout(tryOptimalPosition, 100);
				setTimeout(() => {
					tryOptimalPosition();
					const pos = calculateOptimalToolbarPosition(toolbar);
					if (pos) storeToolbarPosition(pos.top, pos.left, toolbar);
				}, 300);
			});
		} else {
			// Apply saved custom position immediately
			toolbar.style.top = savedPos.top + 'px';
			toolbar.style.left = (window.innerWidth - toolbar.offsetWidth) / 2 + 'px';
			toolbar.style.transform = 'none';
		}
	} else {
		// No saved position - calculate centered position
		const header = document.querySelector('.app-header');
		if (header) {
			const headerRect = header.getBoundingClientRect();
			toolbar.style.top = (headerRect.bottom + 10) + 'px';
			toolbar.style.left = '50%';
			toolbar.style.transform = 'translateX(-50%)';
		}
		
		// Position correctly after elements load
		const tryPosition = () => {
			toolbar.style.transform = 'none';
			positionToolbarCentered(toolbar, false);
		};
		
		const finalPosition = () => {
			toolbar.style.transform = 'none';
			positionToolbarCentered(toolbar, true);
			localStorage.setItem('toolbarOptimal', 'true');
		};
		
		setTimeout(tryPosition, 0);
		setTimeout(tryPosition, 50);
		setTimeout(tryPosition, 100);
		window.addEventListener('load', () => {
			tryPosition();
			setTimeout(finalPosition, 300);
		});
	}
	
	// Make toolbar draggable (vertical only)
	makeDraggable(toolbar);
	
	// Clamp on resize
	let resizeTimeout;
	window.addEventListener('resize', () => {
		clearTimeout(resizeTimeout);
		resizeTimeout = setTimeout(() => {
			clampToolbarInView();
		}, 100);
	});
}

function makeDraggable(element) {
	let isDragging = false;
	let startY = 0;
	let startTop = 0;
	
	const onStart = (e) => {
		// Don't drag if clicking a button
		if (e.target.closest('.toolbar-button')) return;
		
		isDragging = true;
		const clientY = e.touches ? e.touches[0].clientY : e.clientY;
		startY = clientY;
		startTop = element.offsetTop;
		element.style.cursor = 'grabbing';
		element.style.transition = 'none';
		
		e.preventDefault();
	};
	
	const onMove = (e) => {
		if (!isDragging) return;
		
		const clientY = e.touches ? e.touches[0].clientY : e.clientY;
		const deltaY = clientY - startY;
		let newTop = startTop + deltaY;
		
		// Clamp to viewport
		const minTop = 10;
		const maxTop = window.innerHeight - element.offsetHeight - 10;
		newTop = Math.max(minTop, Math.min(maxTop, newTop));
		
		element.style.top = newTop + 'px';
		
		e.preventDefault();
	};
	
	const onEnd = () => {
		if (!isDragging) return;
		isDragging = false;
		element.style.cursor = 'grab';
		element.style.transition = '';
		
		// Save position with snap-to-optimal behavior
		const numericTop = parseFloat(element.style.top) || 100;
		const numericLeft = parseFloat(element.style.left) || 0;
		
		// Check if in snap zone - if so, snap to optimal
		const optimal = calculateOptimalToolbarPosition(element);
		if (optimal && isInSnapZone(numericTop, element)) {
			element.style.left = optimal.left + 'px';
			element.style.top = optimal.top + 'px';
			element.style.transform = 'none';
			storeToolbarPosition(optimal.top, optimal.left, element);
			localStorage.setItem('toolbarOptimal', 'true');
		} else {
			storeToolbarPosition(numericTop, numericLeft, element);
			localStorage.removeItem('toolbarOptimal');
		}
	};
	
	// Mouse events
	element.addEventListener('mousedown', onStart);
	document.addEventListener('mousemove', onMove);
	document.addEventListener('mouseup', onEnd);
	
	// Touch events
	element.addEventListener('touchstart', onStart, { passive: false });
	document.addEventListener('touchmove', onMove, { passive: false });
	document.addEventListener('touchend', onEnd);
}


function updateExportButtonState() {
	const exportBtn = $('exportFavs');
	if (exportBtn) {
		exportBtn.disabled = getFavs().length === 0;
	}
}

// Export/Import Favorites
function exportFavorites() {
	const favs = getFavs();
	if (favs.length === 0) {
		showNotification('No favorites to export!');
		return;
	}

	const data = {
		app: 'AuntyAcid',
		version: '1.0',
		exportDate: new Date().toISOString(),
		favorites: favs
	};

	const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `auntyacid-favorites-${Core.toYmd(new Date(), '-')}.json`;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);

	showNotification(`Exported ${favs.length} favorite(s)!`);
}

function importFavorites() {
	$('importFile')?.click();
}

function handleImportFile(event) {
	const file = event.target.files[0];
	if (!file) return;

	const reader = new FileReader();
	reader.onload = (e) => {
		const data = Core.safeJsonParse(e.target.result, null);
		if (!data || !Array.isArray(data.favorites)) {
			showNotification('Invalid favorites file format!');
			return;
		}

		const { favorites: imported, rejected } = Core.sanitizeFavorites(data.favorites, START_DATE, todayDate());
		if (imported.length === 0) {
			showNotification('No valid favorites found in this file.');
			return;
		}

		const currentFavs = getFavs();
		const newFavs = [...new Set([...currentFavs, ...imported])].sort();
		setFavs(newFavs);

		const importedCount = newFavs.length - currentFavs.length;
		const skipped = rejected ? ` Skipped ${rejected} invalid entr${rejected === 1 ? 'y' : 'ies'}.` : '';
		showNotification(`Imported ${importedCount} new favorite(s)! Total: ${newFavs.length}.${skipped}`, 4000);

		if (displayedDate) updateFavIcon(newFavs.includes(Core.toYmd(displayedDate)));
		updateExportButtonState();
		updateNavState();
	};
	reader.onerror = () => showNotification('Error reading favorites file!');
	reader.readAsText(file);
	event.target.value = '';
}

// PWA Install Prompt
window.addEventListener('beforeinstallprompt', (e) => {
	e.preventDefault();
	deferredPrompt = e;
	showInstallButton();
});

function showInstallButton() {
	const installBtn = $('installBtn');
	if (installBtn && deferredPrompt) {
		installBtn.style.display = 'block';
	}
}

async function handleInstall() {
	if (!deferredPrompt) return;

	deferredPrompt.prompt();
	const { outcome } = await deferredPrompt.userChoice;

	if (outcome === 'accepted') {
		showNotification('App installed successfully!');
	}

	deferredPrompt = null;
	const installBtn = $('installBtn');
	if (installBtn) installBtn.style.display = 'none';
}

// ========================================
// SHARING
// ========================================

function comicShareUrl(date) {
	const url = new URL('./', window.location.href);
	url.searchParams.set('date', Core.toYmd(date, '-'));
	return url.toString();
}

async function fetchComicFile(url, date) {
	const controller = new AbortController();
	// Keep this short: navigator.share() needs the user activation that started the click.
	const timeout = setTimeout(() => controller.abort(), 3000);
	try {
		const response = await fetch(url, { mode: 'cors', signal: controller.signal });
		if (!response.ok) return null;
		const blob = await response.blob();
		const type = blob.type || 'image/jpeg';
		const extension = type.includes('png') ? 'png' : type.includes('gif') ? 'gif' : 'jpg';
		return new File([blob], `aunty-acid-${Core.toYmd(date, '-')}.${extension}`, { type });
	} catch {
		return null;
	} finally {
		clearTimeout(timeout);
	}
}

async function copyShareLink(url) {
	try {
		await navigator.clipboard.writeText(url);
		showNotification('Link to this comic copied to clipboard!');
	} catch {
		showNotification(`Couldn't share automatically. Link: ${url}`, 8000);
	}
}

async function Share() {
	if (!displayedDate || !pictureUrl) {
		showNotification('No comic to share. Please load a comic first.');
		return;
	}

	const shareUrl = comicShareUrl(displayedDate);
	const title = `Aunty Acid - ${formatLongDate(displayedDate)}`;

	if (!navigator.share) {
		await copyShareLink(shareUrl);
		return;
	}

	try {
		const file = await fetchComicFile(pictureUrl, displayedDate);
		if (file && navigator.canShare?.({ files: [file] })) {
			await navigator.share({ title, text: title, url: shareUrl, files: [file] });
		} else {
			await navigator.share({ title, text: title, url: shareUrl });
		}
	} catch (err) {
		if (err.name === 'AbortError') return;
		// File sharing rejected or user activation expired - try a plain link, then the clipboard
		try {
			await navigator.share({ title, text: title, url: shareUrl });
		} catch (fallbackErr) {
			if (fallbackErr.name !== 'AbortError') await copyShareLink(shareUrl);
		}
	}
}

// ========================================
// FAVORITES
// ========================================

function setFavoritesMode(enabled) {
	const checkbox = $('showfavs');
	if (checkbox) checkbox.checked = enabled;
	localStorage.setItem('showfavs', enabled ? 'true' : 'false');
}

function nearestFavorite(favs, date) {
	const { previous, next } = Core.favoriteNeighbors(favs, date);
	return Core.parseYmd(previous || next || favs[0]);
}

function Addfav() {
	if (!displayedDate) {
		showNotification('No comic loaded yet.');
		return;
	}

	const ymd = Core.toYmd(displayedDate);
	const favs = getFavs();
	const index = favs.indexOf(ymd);

	if (index === -1) {
		favs.push(ymd);
		favs.sort();
		setFavs(favs);
		updateFavIcon(true);
	} else {
		favs.splice(index, 1);
		setFavs(favs);
		updateFavIcon(false);

		if (isFavoritesMode()) {
			if (favs.length === 0) {
				setFavoritesMode(false);
				showNotification('No favorites left - showing all comics.');
			} else {
				// The comic on screen is no longer a favorite; move to the closest remaining one
				const { previous, next } = Core.favoriteNeighbors(favs, displayedDate);
				showComic(Core.parseYmd(next || previous), 'morph');
			}
		}
	}

	updateExportButtonState();
	updateNavState();
}

// ========================================
// NAVIGATION
// ========================================

// Navigation continues from the most recently requested date so rapid clicks keep advancing.
function navigationBase() {
	return selectedDate || displayedDate || todayDate();
}

function favoritesForNavigation() {
	const favs = getFavs();
	return isFavoritesMode() && favs.length ? favs : null;
}

function PreviousClick() {
	const base = navigationBase();
	const favs = favoritesForNavigation();
	if (favs) {
		const { previous } = Core.favoriteNeighbors(favs, base);
		if (previous) showComic(Core.parseYmd(previous), 'previous');
	} else if (base > START_DATE) {
		showComic(Core.addDays(base, -1), 'previous');
	}
}

function NextClick() {
	const base = navigationBase();
	const favs = favoritesForNavigation();
	if (favs) {
		const { next } = Core.favoriteNeighbors(favs, base);
		if (next) showComic(Core.parseYmd(next), 'next');
	} else if (base < todayDate()) {
		showComic(Core.addDays(base, 1), 'next');
	}
}

function FirstClick() {
	const favs = favoritesForNavigation();
	showComic(favs ? Core.parseYmd(favs[0]) : START_DATE, 'morph');
}

function CurrentClick() {
	const favs = favoritesForNavigation();
	if (favs) {
		showComic(Core.parseYmd(favs[favs.length - 1]), 'morph');
	} else {
		showComic(todayDate(), 'morph', { fallbackToPrevious: true });
	}
}

function randomTarget() {
	const favs = favoritesForNavigation();
	if (favs) {
		const current = displayedDate ? Core.toYmd(displayedDate) : null;
		const pool = favs.length > 1 ? favs.filter(fav => fav !== current) : favs;
		return Core.parseYmd(pool[Math.floor(Math.random() * pool.length)]);
	}
	const spanDays = Math.round((todayDate() - START_DATE) / 86400000);
	return Core.addDays(START_DATE, Math.floor(Math.random() * (spanDays + 1)));
}

function RandomClick() {
	showComic(randomTarget(), 'morph');
}

function DateChange() {
	const picked = Core.parseYmd($('DatePicker').value);
	if (picked) showComic(picked, 'morph');
}

function openDatePicker() {
	const picker = $('DatePicker');
	if (!picker || picker.disabled) return;
	try {
		picker.showPicker();
	} catch {
		picker.focus();
		picker.click();
	}
}

// Trigger a toolbar action only when its button is enabled (used by swipe and keyboard)
function triggerNav(buttonId) {
	const button = $(buttonId);
	if (button && !button.disabled) button.click();
}

// ========================================
// COMIC LOADING & DISPLAY
// ========================================

function describeLoadError(error, date) {
	const when = formatLongDate(date);
	switch (error?.kind) {
		case 'offline':
			return "You're offline and this comic isn't saved on this device yet.";
		case 'http':
			return `GoComics didn't return the comic for ${when} (error ${error.status}).`;
		case 'no-image':
			return `No comic found for ${when}.`;
		case 'image':
			return `Couldn't load the comic image for ${when}.`;
		default:
			return "Couldn't reach the comic server. Please check your connection.";
	}
}

/**
 * Load and display the comic for a date.
 * direction: 'next'/'previous' (throw-out), 'morph' (blur) or null (instant).
 * Only the most recent request may update the screen, so slow responses can't overwrite newer ones.
 */
function showComic(date, direction = null, { fallbackToPrevious = false, skips = 0 } = {}) {
	const target = Core.clampDate(date, START_DATE, todayDate());
	const ymd = Core.toYmd(target);
	const sequence = ++loadSequence;
	const favoritesMode = isFavoritesMode();

	selectedDate = target;
	updateNavState();

	getComicImageUrl(ymd)
		.then(url => {
			if (sequence !== loadSequence) return;

			// A day without its own strip can resolve to the one already on screen; keep stepping.
			const step = direction === 'next' ? 1 : direction === 'previous' ? -1 : 0;
			if (url === pictureUrl && step && !favoritesMode && skips < MAX_SAME_IMAGE_SKIPS) {
				const nextTarget = Core.addDays(target, step);
				if (nextTarget >= START_DATE && nextTarget <= todayDate()) {
					showComic(nextTarget, direction, { skips: skips + 1 });
					return;
				}
			}

			return loadImage(url).then(() => {
				if (sequence === loadSequence) displayComic(target, url, direction);
			});
		})
		.catch(error => {
			if (sequence !== loadSequence) return;

			// The image URL may be stale; look the page up again next time (unless simply offline)
			if (error?.kind === 'image') forgetImageUrl(ymd);

			// Today's strip may not be published yet in the user's timezone
			if (fallbackToPrevious && Core.sameDay(target, todayDate()) && (error.kind === 'http' || error.kind === 'no-image')) {
				showComic(Core.addDays(target, -1), direction);
				return;
			}

			selectedDate = displayedDate;
			updateNavState();
			showNotification(describeLoadError(error, target), 6000, {
				label: 'Retry',
				handler: () => showComic(target, direction)
			});
		});
}

function displayComic(date, url, direction) {
	const previousPicture = pictureUrl;
	displayedDate = date;
	selectedDate = date;
	pictureUrl = url;

	localStorage.setItem('lastcomic', Core.toYmd(date, '-'));

	// A load-error toast (the only kind with an action) is obsolete once a comic displays
	if ($('notificationAction') && !$('notificationAction').hidden) hideNotification();

	const comicImg = $('comic');
	comicImg.alt = `Aunty Acid comic for ${formatLongDate(date)}`;
	if (url !== previousPicture) {
		renderComicImage(comicImg, url, previousPicture ? direction : null);
	}

	updateFavIcon(getFavs().includes(Core.toYmd(date)));
	updateNavState();
	preloadAdjacentComics(date);

	// Ensure toolbar doesn't overlap the newly loaded comic
	if (comicImg.complete) {
		setTimeout(clampToolbarInView, 50);
	} else {
		comicImg.addEventListener('load', () => setTimeout(clampToolbarInView, 50), { once: true });
	}
}

function renderComicImage(comicImg, url, direction) {
	const wrapper = $('comic-wrapper');
	if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
		direction = null;
	}

	if (direction === 'next' || direction === 'previous') {
		// THROW-OUT animation - fling old comic away while new fades in
		const throwOutClass = direction === 'previous' ? 'throw-out-right' : 'throw-out-left';

		const outgoingClone = comicImg.cloneNode(true);
		outgoingClone.removeAttribute('id');
		outgoingClone.setAttribute('aria-hidden', 'true');
		outgoingClone.classList.add('comic-outgoing');
		outgoingClone.classList.remove('throw-out-left', 'throw-out-right', 'no-transition', 'fade-in-new', 'visible');
		wrapper.appendChild(outgoingClone);

		comicImg.classList.add('fade-in-new');
		applyImageSource(comicImg, url);

		// Force reflow
		outgoingClone.offsetHeight;

		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				outgoingClone.classList.add(throwOutClass);
				comicImg.classList.add('visible');
				setTimeout(() => {
					outgoingClone.remove();
					comicImg.classList.remove('fade-in-new', 'visible');
				}, 400);
			});
		});
	} else if (direction === 'morph') {
		// BLUR MORPH animation - blur out old, reveal new underneath
		const outgoingClone = comicImg.cloneNode(true);
		outgoingClone.removeAttribute('id');
		outgoingClone.setAttribute('aria-hidden', 'true');
		outgoingClone.classList.add('comic-pixelate-outgoing');
		wrapper.appendChild(outgoingClone);

		applyImageSource(comicImg, url);

		const startMorph = () => {
			requestAnimationFrame(() => outgoingClone.classList.add('morph-out'));
			setTimeout(() => outgoingClone.remove(), 600);
		};

		if (comicImg.complete) {
			startMorph();
		} else {
			comicImg.addEventListener('load', startMorph, { once: true });
			comicImg.addEventListener('error', startMorph, { once: true });
		}
	} else {
		applyImageSource(comicImg, url);
	}
}

// Button, date picker and checkbox state for the current navigation position
function updateNavState() {
	const favs = getFavs();
	const favoritesMode = isFavoritesMode() && favs.length > 0;
	const base = navigationBase();
	const baseKey = Core.toYmd(base);
	const today = todayDate();

	const picker = $('DatePicker');
	if (picker) {
		picker.min = Core.toYmd(START_DATE, '-');
		picker.max = Core.toYmd(today, '-');
		picker.value = Core.toYmd(base, '-');
		picker.disabled = favoritesMode;
	}
	const pickerButton = $('DatePickerBtn');
	if (pickerButton) pickerButton.disabled = favoritesMode;

	let noPrevious, noNext, atFirst, atLast;
	if (favoritesMode) {
		const { previous, next } = Core.favoriteNeighbors(favs, base);
		noPrevious = !previous;
		noNext = !next;
		atFirst = baseKey === favs[0];
		atLast = baseKey === favs[favs.length - 1];
	} else {
		noPrevious = atFirst = base <= START_DATE;
		noNext = atLast = base >= today;
	}

	$('Previous').disabled = noPrevious;
	$('First').disabled = atFirst;
	$('Next').disabled = noNext;
	$('Current').disabled = atLast;
	$('Random').disabled = favoritesMode && favs.length === 1 && atFirst;

	const showfavs = $('showfavs');
	if (showfavs) {
		showfavs.disabled = favs.length === 0;
		if (favs.length === 0) showfavs.checked = false;
	}
}

// ========================================
// INITIALIZATION
// ========================================

function initialComicDate(favs) {
	const params = new URLSearchParams(window.location.search);
	const showfavs = $('showfavs');

	showfavs.checked = localStorage.getItem('showfavs') === 'true' && favs.length > 0;
	if (params.get('view') === 'favorites' && favs.length > 0) {
		setFavoritesMode(true);
	}

	// Shared links (?date=YYYY-MM-DD) always open the shared comic
	const linked = Core.parseYmd(params.get('date') || '');
	if (linked && linked >= START_DATE && linked <= todayDate()) {
		showfavs.checked = false;
		params.delete('date');
		const query = params.toString();
		history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : '') + window.location.hash);
		return linked;
	}

	if (params.get('action') === 'random') {
		return randomTarget();
	}

	let start = null;
	if ($('lastdate').checked) {
		const stored = Core.parseStoredDate(localStorage.getItem('lastcomic'));
		if (stored && stored >= START_DATE && stored <= todayDate()) start = stored;
	}

	if (showfavs.checked) {
		if (!start) return Core.parseYmd(favs[0]);
		if (!favs.includes(Core.toYmd(start))) return nearestFavorite(favs, start);
	}

	return start;
}

function initApp() {
	const favs = getFavs();
	const start = initialComicDate(favs) || todayDate();
	showComic(start, null, { fallbackToPrevious: Core.sameDay(start, todayDate()) });
	updateExportButtonState();
}

// Native Swipe Detection
const SWIPE_IGNORE_SELECTOR = '#mainToolbar, .settings-panel, .notification-toast, #installBtn, button, input';

const swipeDetection = {
	startX: 0,
	startY: 0,
	threshold: 50, // Minimum distance for swipe
	restraint: 100, // Maximum perpendicular distance
	allowedTime: 500, // Maximum time for swipe
	startTime: 0,
	tracking: false,

	init() {
		const target = document.body;

		target.addEventListener('touchstart', (e) => {
			// Ignore multi-touch (pinch zoom) and gestures on controls such as the draggable toolbar
			if (e.touches.length > 1 || e.target.closest(SWIPE_IGNORE_SELECTOR)) {
				this.tracking = false;
				return;
			}
			const touch = e.changedTouches[0];
			this.tracking = true;
			this.startX = touch.pageX;
			this.startY = touch.pageY;
			this.startTime = Date.now();
		}, { passive: true });

		target.addEventListener('touchend', (e) => {
			if (!this.tracking) return;
			this.tracking = false;
			if (!$('swipe')?.checked || $('settingsDIV')?.classList.contains('visible')) return;

			const touch = e.changedTouches[0];
			const distX = touch.pageX - this.startX;
			const distY = touch.pageY - this.startY;
			const elapsedTime = Date.now() - this.startTime;

			if (elapsedTime > this.allowedTime) return;

			if (Math.abs(distX) >= this.threshold && Math.abs(distY) <= this.restraint) {
				triggerNav(distX > 0 ? 'Previous' : 'Next');
			} else if (Math.abs(distY) >= this.threshold && Math.abs(distX) <= this.restraint) {
				triggerNav(distY > 0 ? 'Random' : 'Current');
			}
		}, { passive: true });
	}
};

swipeDetection.init();

// Keyboard shortcuts: Left/Right previous/next, Home/End first/latest, Esc closes settings
document.addEventListener('keydown', (e) => {
	const settingsOpen = $('settingsDIV')?.classList.contains('visible');
	if (e.key === 'Escape') {
		if (settingsOpen) hideSettings({ restoreFocus: true });
		return;
	}
	if (settingsOpen || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
	if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;

	const actions = { ArrowLeft: 'Previous', ArrowRight: 'Next', Home: 'First', End: 'Current' };
	const buttonId = actions[e.key];
	if (!buttonId) return;
	e.preventDefault();
	triggerNav(buttonId);
});

// Event Listeners - DOM Content Loaded
document.addEventListener('DOMContentLoaded', () => {
	const swipeCheckbox = $('swipe');
	const lastdateCheckbox = $('lastdate');
	if (swipeCheckbox) swipeCheckbox.checked = localStorage.getItem('stat') !== 'false';
	if (lastdateCheckbox) lastdateCheckbox.checked = localStorage.getItem('lastdate') !== 'false';

	// Navigation buttons
	$('First')?.addEventListener('click', FirstClick);
	$('Previous')?.addEventListener('click', PreviousClick);
	$('Random')?.addEventListener('click', RandomClick);
	$('DatePicker')?.addEventListener('change', DateChange);
	$('Next')?.addEventListener('click', NextClick);
	$('Current')?.addEventListener('click', CurrentClick);
	$('DatePickerBtn')?.addEventListener('click', openDatePicker);

	initializeToolbar();

	// Icon buttons
	$('settingsBtn')?.addEventListener('click', toggleSettings);
	$('favheart')?.addEventListener('click', Addfav);
	$('shareBtn')?.addEventListener('click', Share);

	// Settings panel
	$('settingsCloseBtn')?.addEventListener('click', () => hideSettings({ restoreFocus: true }));
	$('exportFavs')?.addEventListener('click', exportFavorites);
	$('importFavs')?.addEventListener('click', importFavorites);
	$('importFile')?.addEventListener('change', handleImportFile);

	$('notificationClose')?.addEventListener('click', hideNotification);
	$('installBtn')?.addEventListener('click', handleInstall);

	// Checkbox handlers
	$('swipe')?.addEventListener('change', function() {
		localStorage.setItem('stat', this.checked ? 'true' : 'false');
	});

	$('lastdate')?.addEventListener('change', function() {
		localStorage.setItem('lastdate', this.checked ? 'true' : 'false');
	});

	$('showfavs')?.addEventListener('change', function() {
		setFavoritesMode(this.checked);
		const favs = getFavs();
		const base = navigationBase();
		if (this.checked && favs.length && !favs.includes(Core.toYmd(base))) {
			showComic(nearestFavorite(favs, base), 'morph');
		} else {
			updateNavState();
		}
	});

	// Close settings panel when clicking outside
	document.addEventListener('click', (e) => {
		const panel = $('settingsDIV');
		if (panel?.classList.contains('visible') &&
			!panel.contains(e.target) &&
			!$('settingsBtn')?.contains(e.target)) {
			hideSettings();
		}
	});

	initApp();
});
