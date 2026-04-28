// EV Charger Finder Application
let map;
let markers = [];
let infoWindow;
let chargersData = [];
let filteredData = [];
let userLocation = null;
let searchCircle = null;

// Adelaide CBD as default center
const DEFAULT_CENTER = { lat: -34.9285, lng: 138.6007 };
const DEFAULT_ZOOM = 11;

// Power level mappings
const POWER_LEVELS = {
    '7': { min: 0, max: 7, label: '7 kW', category: 'slow' },
    '22': { min: 8, max: 22, label: 'Up to 22 kW', category: 'medium' },
    '50': { min: 23, max: 50, label: 'Up to 50 kW', category: 'fast' },
    '150': { min: 51, max: 999, label: '50+ kW', category: 'ultra' }
};

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    loadChargersData();
    setupEventListeners();
});

// Load chargers data from JSON
async function loadChargersData() {
    try {
        const response = await fetch('ev-charging-locations.json');
        const data = await response.json();
        
        if (data.IsSuccess && data.Result) {
            chargersData = data.Result.map(processChargerData);
            console.log(`Loaded ${chargersData.length} charging stations`);
        }
    } catch (error) {
        console.error('Error loading charger data:', error);
    }
}

// Process raw charger data
function processChargerData(charger) {
    // Parse the power level from NiceSiteType
    const powerMatch = charger.NiceSiteType?.match(/(\d+)\s*kW/i);
    const powerKw = powerMatch ? parseInt(powerMatch[1]) : 0;
    
    // Get plug types from SitePlugsResult
    const plugTypes = charger.SitePlugsResult?.map(p => p.Plug) || [];
    
    // Calculate total available
    const totalAvailable = charger.SitePlugsResult?.reduce((sum, p) => sum + (p.AvailableCount || 0), 0) || 0;
    const totalPorts = charger.SitePlugsResult?.reduce((sum, p) => sum + (p.Total || 0), 0) || 0;
    
    return {
        id: charger.ID,
        name: charger.SiteName,
        address: charger.Address,
        lat: charger.Lat,
        lng: charger.Long,
        powerKw: powerKw,
        powerLabel: charger.NiceSiteType || 'Unknown',
        plugTypes: plugTypes,
        plugsDetail: charger.SitePlugsResult || [],
        totalAvailable: totalAvailable,
        totalPorts: totalPorts,
        requiresCable: charger.RequireCable,
        costs: charger.Costs,
        isPlanned: charger.IsPlannedSite
    };
}

// Initialize Google Map
function initMap() {
    map = new google.maps.Map(document.getElementById('map'), {
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        styles: getMapStyles(),
        mapTypeControl: false,
        fullscreenControl: true,
        streetViewControl: false
    });
    
    infoWindow = new google.maps.InfoWindow();
    
    // Wait for data to load, then apply filters
    const checkData = setInterval(() => {
        if (chargersData.length > 0) {
            clearInterval(checkData);
            applyFilters();
            hideLoading();
        }
    }, 100);
    
    // Close info window on map click
    map.addListener('click', () => {
        infoWindow.close();
    });
}

// Get custom map styles
function getMapStyles() {
    return [
        {
            featureType: 'poi',
            elementType: 'labels',
            stylers: [{ visibility: 'off' }]
        },
        {
            featureType: 'transit',
            stylers: [{ visibility: 'simplified' }]
        }
    ];
}

// Setup event listeners
function setupEventListeners() {
    // Reset filters button
    document.getElementById('reset-filters').addEventListener('click', resetFilters);
    
    // Use location button
    document.getElementById('use-location').addEventListener('click', getUserLocation);
    
    // Postcode input - auto apply on change
    const postcodeInput = document.getElementById('postcode');
    postcodeInput.addEventListener('input', debounce(applyFilters, 500));
    postcodeInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            applyFilters();
        }
    });
    
    // Checkbox changes - auto apply
    document.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', debounce(applyFilters, 300));
    });
    
    // Radius radio changes - auto apply and update label
    document.querySelectorAll('input[name="radius"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const label = e.target.value === '0' ? 'All of SA' : `${e.target.value} km`;
            document.getElementById('radius-label').textContent = label;
            applyFilters();
        });
    });
    
    // Modal close
    document.querySelector('.modal-close').addEventListener('click', closeModal);
    document.querySelector('.modal-overlay').addEventListener('click', closeModal);
    
    // Dropdown toggles
    setupDropdowns();
    
    // Mobile bottom sheet toggle
    setupMobileBottomSheet();
}

// Setup mobile bottom sheet
function setupMobileBottomSheet() {
    const sheet = document.getElementById('mobile-bottom-sheet');
    const handle = document.getElementById('sheet-handle');
    
    if (!sheet || !handle) return;
    
    handle.addEventListener('click', () => {
        sheet.classList.toggle('collapsed');
    });
    
    // Close sheet when clicking on a result (to see the map)
    const mobileList = document.getElementById('mobile-results-list');
    if (mobileList) {
        mobileList.addEventListener('click', () => {
            sheet.classList.add('collapsed');
        });
    }
}

// Setup dropdown menus
function setupDropdowns() {
    const dropdowns = document.querySelectorAll('.dropdown');
    
    dropdowns.forEach(dropdown => {
        const toggle = dropdown.querySelector('.dropdown-toggle');
        
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            // Close other dropdowns
            dropdowns.forEach(d => {
                if (d !== dropdown) d.classList.remove('open');
            });
            dropdown.classList.toggle('open');
        });
    });
    
    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.dropdown')) {
            dropdowns.forEach(d => d.classList.remove('open'));
        }
    });
    
    // Prevent dropdown from closing when clicking inside
    document.querySelectorAll('.dropdown-menu').forEach(menu => {
        menu.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    });
}

// Debounce helper
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Get user's current location
function getUserLocation() {
    const btn = document.getElementById('use-location');
    btn.classList.add('loading');
    
    if (!navigator.geolocation) {
        alert('Geolocation is not supported by your browser');
        btn.classList.remove('loading');
        return;
    }
    
    navigator.geolocation.getCurrentPosition(
        (position) => {
            userLocation = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };
            
            // Reverse geocode to get suburb/postcode
            const geocoder = new google.maps.Geocoder();
            geocoder.geocode({ location: userLocation }, (results, status) => {
                if (status === 'OK' && results[0]) {
                    const postcodeComponent = results[0].address_components.find(
                        c => c.types.includes('postal_code')
                    );
                    const suburbComponent = results[0].address_components.find(
                        c => c.types.includes('locality')
                    );
                    
                    const displayText = suburbComponent?.long_name || postcodeComponent?.long_name || 'Current Location';
                    document.getElementById('postcode').value = displayText;
                }
                
                btn.classList.remove('loading');
                applyFilters();
            });
        },
        (error) => {
            console.error('Geolocation error:', error);
            alert('Unable to get your location. Please enter a suburb or postcode.');
            btn.classList.remove('loading');
        },
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

// Apply filters and update map
async function applyFilters() {
    showLoading();
    
    // Get filter values
    const postcodeInput = document.getElementById('postcode').value.trim();
    const radiusInput = document.querySelector('input[name="radius"]:checked');
    const radius = radiusInput ? parseFloat(radiusInput.value) : 50;
    const selectedPowers = getSelectedCheckboxValues('power');
    const selectedPlugs = getSelectedCheckboxValues('plug');
    const availableOnly = document.getElementById('available-only').checked;
    
    // Determine center point
    let centerPoint = userLocation || DEFAULT_CENTER;
    
    if (postcodeInput && !userLocation) {
        // Geocode the input
        try {
            centerPoint = await geocodeAddress(postcodeInput);
        } catch (error) {
            console.warn('Geocoding failed, using default center');
        }
    }
    
    // Filter chargers
    filteredData = chargersData.filter(charger => {
        // Power filter
        const powerMatch = selectedPowers.some(powerKey => {
            const level = POWER_LEVELS[powerKey];
            return charger.powerKw >= level.min && charger.powerKw <= level.max;
        });
        if (!powerMatch) return false;
        
        // Plug type filter
        const plugMatch = charger.plugTypes.some(plug => selectedPlugs.includes(plug));
        if (!plugMatch) return false;
        
        // Availability filter
        if (availableOnly && charger.totalAvailable === 0) return false;
        
        // Distance filter (if radius is set)
        if (radius > 0) {
            const distance = calculateDistance(
                centerPoint.lat, centerPoint.lng,
                charger.lat, charger.lng
            );
            charger.distance = distance;
            if (distance > radius) return false;
        } else {
            charger.distance = calculateDistance(
                centerPoint.lat, centerPoint.lng,
                charger.lat, charger.lng
            );
        }
        
        return true;
    });
    
    // Sort by distance
    filteredData.sort((a, b) => a.distance - b.distance);
    
    // Update UI
    updateMarkers(filteredData);
    updateResultsList(filteredData);
    updateResultsCount(filteredData.length);
    
    // Update map view
    if (filteredData.length > 0) {
        fitMapToMarkers();
    } else {
        map.setCenter(centerPoint);
        map.setZoom(radius > 0 ? getZoomForRadius(radius) : DEFAULT_ZOOM);
    }
    
    // Draw search radius circle
    updateSearchCircle(centerPoint, radius);
    
    hideLoading();
}

// Get selected checkbox values
function getSelectedCheckboxValues(name) {
    const checkboxes = document.querySelectorAll(`input[name="${name}"]:checked`);
    return Array.from(checkboxes).map(cb => cb.value);
}

// Geocode address to coordinates
function geocodeAddress(address) {
    return new Promise((resolve, reject) => {
        const geocoder = new google.maps.Geocoder();
        const searchAddress = address.includes('SA') || address.includes('South Australia') 
            ? address 
            : `${address}, South Australia, Australia`;
        
        geocoder.geocode({ address: searchAddress }, (results, status) => {
            if (status === 'OK' && results[0]) {
                resolve({
                    lat: results[0].geometry.location.lat(),
                    lng: results[0].geometry.location.lng()
                });
            } else {
                reject(new Error('Geocoding failed'));
            }
        });
    });
}

// Calculate distance between two points (Haversine formula)
function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371; // Earth's radius in km
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function toRad(deg) {
    return deg * (Math.PI / 180);
}

// Update markers on map
function updateMarkers(chargers) {
    // Clear existing markers
    markers.forEach(marker => marker.setMap(null));
    markers = [];
    
    // Add new markers
    chargers.forEach(charger => {
        const marker = createMarker(charger);
        markers.push(marker);
    });
}

// Create a marker for a charger
function createMarker(charger) {
    const markerColor = getMarkerColor(charger);
    
    const marker = new google.maps.Marker({
        position: { lat: charger.lat, lng: charger.lng },
        map: map,
        title: charger.name,
        icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 10,
            fillColor: markerColor,
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2
        }
    });
    
    marker.addListener('click', () => {
        showInfoWindow(marker, charger);
        highlightResultItem(charger.id);
    });
    
    return marker;
}

// Get marker color based on availability
function getMarkerColor(charger) {
    if (charger.totalAvailable === 0) return '#ef4444'; // Red - none available
    if (charger.totalAvailable < charger.totalPorts) return '#f59e0b'; // Orange - some available
    return '#22c55e'; // Green - all available
}

// Show info window for a charger
function showInfoWindow(marker, charger) {
    const content = `
        <div class="info-window">
            <div class="info-window-header"></div>
            <button class="info-window-close" onclick="closeInfoWindow()">×</button>
            <div class="info-window-body">
                <div class="info-window-title">${charger.name}</div>
                <div class="info-window-address">${charger.address}</div>
                <div class="info-window-meta">
                    <span class="result-tag">${charger.powerLabel}</span>
                    <span class="result-tag ${charger.totalAvailable > 0 ? 'available' : 'unavailable'}">
                        ${charger.totalAvailable}/${charger.totalPorts} available
                    </span>
                </div>
            </div>
        </div>
    `;
    
    infoWindow.setContent(content);
    infoWindow.open(map, marker);
}

// Close info window
function closeInfoWindow() {
    infoWindow.close();
}

// Update results list
function updateResultsList(chargers) {
    const container = document.getElementById('results-list');
    const mobileContainer = document.getElementById('mobile-results-list');
    
    const html = chargers.length === 0 ? `
        <div class="no-results">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"/>
                <path d="m21 21-4.35-4.35"/>
            </svg>
            <h3>No chargers found</h3>
            <p>Try adjusting your filters or search area</p>
        </div>
    ` : chargers.map(charger => `
        <div class="result-item" data-id="${charger.id}" onclick="focusCharger(${charger.id})">
            <div class="result-name">${charger.name}</div>
            <div class="result-address">${charger.address}</div>
            <div class="result-meta">
                <span class="result-tag">${charger.powerLabel}</span>
                <span class="result-tag ${charger.totalAvailable > 0 ? 'available' : 'unavailable'}">
                    ${charger.totalAvailable}/${charger.totalPorts} available
                </span>
                ${charger.plugTypes.map(p => `<span class="result-tag">${p}</span>`).join('')}
            </div>
            ${charger.distance ? `<div class="result-distance">${charger.distance.toFixed(1)} km away</div>` : ''}
        </div>
    `).join('');
    
    container.innerHTML = html;
    if (mobileContainer) {
        mobileContainer.innerHTML = html;
    }
}

// Update results count
function updateResultsCount(count) {
    document.getElementById('results-number').textContent = count;
    const mobileCount = document.getElementById('mobile-results-number');
    if (mobileCount) {
        mobileCount.textContent = count;
    }
}

// Focus on a specific charger
function focusCharger(id) {
    const charger = filteredData.find(c => c.id === id);
    if (!charger) return;
    
    const marker = markers.find((m, i) => filteredData[i]?.id === id);
    if (marker) {
        map.setCenter({ lat: charger.lat, lng: charger.lng });
        map.setZoom(15);
        showInfoWindow(marker, charger);
    }
    
    highlightResultItem(id);
}

// Highlight result item in list
function highlightResultItem(id) {
    document.querySelectorAll('.result-item').forEach(item => {
        item.classList.remove('active');
        if (parseInt(item.dataset.id) === id) {
            item.classList.add('active');
            item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    });
}

// Open charger details modal
function openChargerModal(id) {
    const charger = filteredData.find(c => c.id === id) || chargersData.find(c => c.id === id);
    if (!charger) return;
    
    const modalBody = document.getElementById('modal-body');
    modalBody.innerHTML = `
        <div class="modal-header">
            <h2 class="modal-title">${charger.name}</h2>
            <p class="modal-address">${charger.address}</p>
        </div>
        
        <div class="modal-section">
            <h3 class="modal-section-title">Charging Ports</h3>
            <div class="plug-grid">
                ${charger.plugsDetail.map(plug => `
                    <div class="plug-item">
                        <div class="plug-type">${plug.Plug}</div>
                        <div class="plug-count">
                            <span class="available">${plug.AvailableCount}</span> / ${plug.Total} available
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
        
        <div class="modal-section">
            <h3 class="modal-section-title">Details</h3>
            <div class="modal-info-row">
                <span class="modal-info-label">Charging Speed</span>
                <span class="modal-info-value">${charger.powerLabel}</span>
            </div>
            <div class="modal-info-row">
                <span class="modal-info-label">Cable Required</span>
                <span class="modal-info-value">${charger.requiresCable || 'Unknown'}</span>
            </div>
            ${charger.costs ? `
            <div class="modal-info-row">
                <span class="modal-info-label">Costs</span>
                <span class="modal-info-value">${charger.costs}</span>
            </div>
            ` : ''}
            ${charger.distance ? `
            <div class="modal-info-row">
                <span class="modal-info-label">Distance</span>
                <span class="modal-info-value">${charger.distance.toFixed(1)} km</span>
            </div>
            ` : ''}
        </div>
        
        <div class="modal-actions">
            <button class="btn-directions" onclick="openDirections(${charger.lat}, ${charger.lng})">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 11l19-9-9 19-2-8-8-2z"/>
                </svg>
                Get Directions
            </button>
        </div>
    `;
    
    document.getElementById('charger-modal').classList.add('active');
}

// Close modal
function closeModal() {
    document.getElementById('charger-modal').classList.remove('active');
}

// Open directions in Google Maps
function openDirections(lat, lng) {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    window.open(url, '_blank');
}

// Fit map to show all markers
function fitMapToMarkers() {
    if (markers.length === 0) return;
    
    const bounds = new google.maps.LatLngBounds();
    markers.forEach(marker => {
        bounds.extend(marker.getPosition());
    });
    
    map.fitBounds(bounds);
    
    // Don't zoom in too far for single marker
    const listener = google.maps.event.addListener(map, 'idle', () => {
        if (map.getZoom() > 15) map.setZoom(15);
        google.maps.event.removeListener(listener);
    });
}

// Update search radius circle
function updateSearchCircle(center, radiusKm) {
    if (searchCircle) {
        searchCircle.setMap(null);
    }
    
    if (radiusKm > 0) {
        searchCircle = new google.maps.Circle({
            map: map,
            center: center,
            radius: radiusKm * 1000, // Convert to meters
            fillColor: '#0ea5e9',
            fillOpacity: 0.08,
            strokeColor: '#0ea5e9',
            strokeOpacity: 0.3,
            strokeWeight: 2
        });
    }
}

// Get appropriate zoom level for radius
function getZoomForRadius(radiusKm) {
    if (radiusKm <= 5) return 13;
    if (radiusKm <= 10) return 12;
    if (radiusKm <= 25) return 11;
    if (radiusKm <= 50) return 10;
    if (radiusKm <= 100) return 9;
    return 8;
}

// Reset all filters
function resetFilters() {
    document.getElementById('postcode').value = '5000';
    
    // Reset radius to 50km
    document.querySelectorAll('input[name="radius"]').forEach(r => r.checked = false);
    const defaultRadius = document.querySelector('input[name="radius"][value="50"]');
    if (defaultRadius) defaultRadius.checked = true;
    document.getElementById('radius-label').textContent = '50 km';
    
    document.getElementById('available-only').checked = false;
    
    document.querySelectorAll('input[name="power"], input[name="plug"]').forEach(cb => {
        cb.checked = true;
    });
    
    userLocation = null;
    applyFilters();
}

// Show loading state
function showLoading() {
    document.getElementById('map-loading').classList.remove('hidden');
}

// Hide loading state
function hideLoading() {
    document.getElementById('map-loading').classList.add('hidden');
}

// Make functions globally available
window.initMap = initMap;
window.focusCharger = focusCharger;
window.openChargerModal = openChargerModal;
window.openDirections = openDirections;
