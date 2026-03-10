import * as THREE from "three";
import { VRButton } from "VRButton";
import { DeviceOrientationControls } from "DeviceOrientationControls";

let vrControls = null;
let isActive = false;
let savedCameraState = { pos: new THREE.Vector3(), target: new THREE.Vector3() };

// NEU: WebGL Visor für Cardboard-Filter (da CSS in WebXR ignoriert wird)
let vrFilterMesh = null;

function showVRLoader(show, text = 'Lade 3D-Assets...') {
    let loader = document.getElementById('vr-local-loader');
    if (show) {
        if (!loader) {
            loader = document.createElement('div');
            loader.id = 'vr-local-loader';
            loader.style.cssText = 'position:fixed; inset:0; background:rgba(17,24,39,0.95); z-index:99999; display:flex; flex-direction:column; align-items:center; justify-content:center; color:white; font-family:"Inter", sans-serif; backdrop-filter:blur(10px);';
            
            const spinner = document.createElement('div');
            spinner.style.cssText = 'width:50px; height:50px; border:4px solid rgba(255,255,255,0.2); border-top-color:#3b82f6; border-radius:50%; animation:vr-spin 1s linear infinite; margin-bottom:20px;';
            
            const style = document.createElement('style');
            style.textContent = '@keyframes vr-spin { to { transform: rotate(360deg); } }';
            document.head.appendChild(style);
            
            const textEl = document.createElement('div');
            textEl.id = 'vr-loader-text';
            textEl.style.fontSize = '18px';
            textEl.style.fontWeight = 'bold';
            textEl.innerText = text;
            
            loader.appendChild(spinner);
            loader.appendChild(textEl);
            document.body.appendChild(loader);
        } else {
            document.getElementById('vr-loader-text').innerText = text;
            loader.style.display = 'flex';
        }
    } else {
        if (loader) loader.style.display = 'none';
    }
}

function toggleMainUI(show) {
    const uiLayer = document.getElementById('ui-layer');
    const homeScreen = document.getElementById('homescreen');
    const overlay = document.getElementById('modal-overlay');
    const scenarioLayer = document.getElementById('scenario-ui-layer');
    
    if (show) {
        if (window.app && typeof window.app.goHome === 'function') {
            window.app.goHome(); 
        } else if(homeScreen) {
            homeScreen.style.display = 'flex';
        }
        if(overlay) overlay.classList.remove('active');
    } else {
        if(uiLayer) uiLayer.style.display = 'none';
        if(homeScreen) homeScreen.style.display = 'none';
        if(scenarioLayer) scenarioLayer.style.display = 'none';
        if(overlay) overlay.classList.remove('active');
    }
}

async function enterFullscreenAndLandscape() {
    const elem = document.documentElement;
    try {
        if (elem.requestFullscreen) await elem.requestFullscreen();
        else if (elem.webkitRequestFullscreen) await elem.webkitRequestFullscreen();
        if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape').catch(()=>{}); 
    } catch (err) { console.warn("Fullscreen/Orientation restricted.", err); }
}

// Übersetzt HTML/CSS Klicks in echtes 3D-Material für VR
function applyVRWebGLFilter(filterStr) {
    if (!vrFilterMesh || !window.app.mainScene) return;
    
    // Reset
    vrFilterMesh.material.opacity = 0;
    vrFilterMesh.material.color.setHex(0xffffff);
    if (window.app.mainScene.fog) window.app.mainScene.fog.density = 0;

    if (filterStr === 'none') return;

    // Simulationen
    if (filterStr.includes('sim-blur') || filterStr.includes('low')) {
        window.app.mainScene.fog.density = 0.05;
    }
    if (filterStr.includes('sim-severe')) {
        window.app.mainScene.fog.density = 0.15;
        vrFilterMesh.material.color.setHex(0xaaaaaa);
        vrFilterMesh.material.opacity = 0.3;
    }
    if (filterStr.includes('sim-blind')) {
        vrFilterMesh.material.color.setHex(0x000000);
        vrFilterMesh.material.opacity = 0.98;
    }
    if (filterStr.includes('sim-cataract')) { // Grauer Star (Trübung + Gelbstich)
        vrFilterMesh.material.color.setHex(0xd4b872);
        vrFilterMesh.material.opacity = 0.4;
        window.app.mainScene.fog.density = 0.1;
    }
    if (filterStr.includes('sim-glaucoma')) { // Grüner Star (Dunkel, reduzierter Kontrast)
        vrFilterMesh.material.color.setHex(0x000000);
        vrFilterMesh.material.opacity = 0.7; 
    }
}

function initOverlayListeners() {
    const closeBtn = document.getElementById('vr-close-btn');
    if (closeBtn && !closeBtn.dataset.vrBound) {
        closeBtn.addEventListener('click', stopVRMode);
        closeBtn.dataset.vrBound = "true";
    }

    document.querySelectorAll('.vr-filter-btn').forEach(btn => {
        if (!btn.dataset.vrBound) {
            btn.addEventListener('click', (e) => {
                // 1. Für den normalen Bildschirm (ohne Cardboard)
                document.body.className = document.body.className.replace(/sim-[^\s]+/g, '').trim();
                const filterStr = e.target.getAttribute('data-filter');
                if (filterStr !== 'none') {
                    const filters = filterStr.split(' ');
                    filters.forEach(f => document.body.classList.add(f));
                }
                
                // 2. Für das echte VR/Cardboard (WebGL)
                applyVRWebGLFilter(filterStr);

                // UI Update
                document.querySelectorAll('.vr-filter-btn').forEach(b => {
                    b.style.background = 'rgba(255,255,255,0.1)';
                    b.style.color = '#d1d5db';
                });
                e.target.style.background = '#3b82f6';
                e.target.style.color = 'white';
            });
            btn.dataset.vrBound = "true";
        }
    });
}

// Styling Injection für den hässlichen ThreeJS Standard-Button
function injectVRButtonStyle() {
    if (document.getElementById('vr-btn-style')) return;
    const style = document.createElement('style');
    style.id = 'vr-btn-style';
    style.innerHTML = `
        #webxr-btn {
            background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%) !important;
            color: white !important;
            border: 2px solid rgba(255,255,255,0.3) !important;
            border-radius: 12px !important;
            padding: 16px 28px !important;
            font-family: 'Inter', sans-serif !important;
            font-weight: 800 !important;
            font-size: 14px !important;
            box-shadow: 0 10px 25px rgba(59,130,246,0.6) !important;
            text-transform: uppercase !important;
            letter-spacing: 1.5px !important;
            transition: transform 0.2s !important;
        }
        #webxr-btn:hover { transform: translateX(-50%) scale(1.05) !important; }
    `;
    document.head.appendChild(style);
}

export async function startVRMode() {
    try {
        if (isActive) return;
        
        // 1. Engine Start & Auto-Setup (verhindert leeren Raum)
        if (!window.app || !window.app.renderer || !window.app.mainScene) {
            if (window.app && typeof window.app.initEngine === 'function') {
                showVRLoader(true, 'Starte 3D Engine...');
                window.app.initEngine();
                await new Promise(resolve => setTimeout(resolve, 1500)); 
            } else {
                alert("Fehler: Engine nicht bereit.");
                return;
            }
        }

        // AUTO-FILL LOGIK: Wenn der Raum fast leer ist, spawnen wir ein Basis-Setup!
        // Wir suchen die Möbel via ASSETS aus script.js
        if (window.app.movableObjects && window.app.movableObjects.length < 2 && window.app.addFurniture) {
            showVRLoader(true, 'Baue SensAble Lab auf...');
            try {
                // Wir nutzen die Funktionen deiner script.js, um Tische sauber zu setzen
                await window.app.addFurniture('k6');
                if (window.app.movableObjects.length > 0) {
                    const t1 = window.app.movableObjects[window.app.movableObjects.length - 1];
                    t1.position.set(-1.94, 0.22, -1.59);
                }
                await window.app.addFurniture('k6');
                if (window.app.movableObjects.length > 0) {
                    const t2 = window.app.movableObjects[window.app.movableObjects.length - 1];
                    t2.position.set(2.06, 0.22, -1.31);
                    t2.rotation.y = 0.78;
                }
                await window.app.addFurniture('board');
                if (window.app.movableObjects.length > 0) {
                    const board = window.app.movableObjects[window.app.movableObjects.length - 1];
                    board.position.set(0, 0.22, -3.85);
                }
            } catch(e) { console.warn("Auto-Setup fehlgeschlagen", e); }
        }
        
        showVRLoader(true, 'VR/360° Modus wird initialisiert...');
        
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            try {
                await Promise.race([
                    DeviceOrientationEvent.requestPermission(),
                    new Promise(resolve => setTimeout(() => resolve('timeout'), 1500))
                ]);
            } catch (error) { console.warn('Gyroskop-Fehler:', error); }
        }

        enterFullscreenAndLandscape().catch(e => console.warn(e));

        const renderer = window.app.renderer;
        const camera = window.app.mainCamera;
        
        renderer.xr.enabled = true;
        
        // 2. Kamera sichern
        savedCameraState.pos.copy(camera.position);
        if (window.app.mainControls) {
            savedCameraState.target.copy(window.app.mainControls.target);
            window.app.mainControls.enabled = false; 
        }

        // 3. WebGL Visor für Cardboard-Filter installieren
        if (vrFilterMesh) { camera.remove(vrFilterMesh); }
        const filterGeo = new THREE.PlaneGeometry(10, 10);
        const filterMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
        vrFilterMesh = new THREE.Mesh(filterGeo, filterMat);
        vrFilterMesh.position.z = -0.1; // Direkt vor die Kameralinse
        vrFilterMesh.renderOrder = 9999;
        camera.add(vrFilterMesh);
        window.app.mainScene.add(camera);

        // 4. Perspektive exakt auf den Avatar setzen (oder Raummitte)
        let startPos = new THREE.Vector3(0, 1.62, 0);
        window.app.mainScene.traverse((child) => {
            if (child.userData && child.userData.isAvatar) {
                startPos.copy(child.position);
                startPos.y += 1.62; 
            }
        });
        camera.position.copy(startPos);

        // 5. Gyroskop aktivieren
        try {
            vrControls = new DeviceOrientationControls(camera);
        } catch(e) {
            console.warn("DeviceOrientationControls Fallback:", e);
            vrControls = null;
        }

        // 6. UI aufräumen
        toggleMainUI(false);
        const overlay = document.getElementById('vr-overlay');
        if (overlay) overlay.style.display = 'block';

        initOverlayListeners();

        // 7. Render-Loop starten
        const renderVR = () => {
            if (vrControls && !renderer.xr.isPresenting) {
                vrControls.update();
            }
            renderer.render(window.app.mainScene, camera);
        };

        renderer.setAnimationLoop(renderVR);
        isActive = true;
        
        // 8. Wunderschönen WebXR Button generieren
        injectVRButtonStyle();
        try {
            const oldBtn = document.getElementById('webxr-btn');
            if(oldBtn) oldBtn.remove();

            const vrBtn = VRButton.createButton(renderer);
            vrBtn.id = 'webxr-btn';
            vrBtn.style.position = 'absolute';
            vrBtn.style.bottom = '80px';
            vrBtn.style.left = '50%';
            vrBtn.style.transform = 'translateX(-50%)';
            vrBtn.style.pointerEvents = 'auto'; 
            vrBtn.style.zIndex = '999999';
            if (overlay) overlay.appendChild(vrBtn);

            // Text anpassen und verstecken, wenn Desktop ohne Headset
            setTimeout(() => {
                const btn = document.getElementById('webxr-btn');
                if (btn) {
                    if (btn.innerText.toLowerCase().includes('enter vr')) {
                        btn.innerText = '🥽 VR-Brille / Cardboard';
                    }
                    if (btn.disabled || btn.innerText.toLowerCase().includes('supported')) {
                        btn.style.display = 'none';
                    }
                }
            }, 500);
        } catch(e) { console.error("VRButton Error:", e); }

        showVRLoader(false);

    } catch(globalError) {
        console.error("VR Start Error:", globalError);
        showVRLoader(false);
    }
}

export function stopVRMode() {
    if (!isActive) return;
    isActive = false;

    const vrBtn = document.getElementById('webxr-btn');
    if (vrBtn) vrBtn.remove();

    const renderer = window.app.renderer;
    const camera = window.app.mainCamera;

    // Loop zurückgeben
    renderer.setAnimationLoop(window.app.mainAnimate);
    
    if (vrControls) {
        vrControls.dispose();
        vrControls = null;
    }

    // Visor entfernen
    if (vrFilterMesh) {
        camera.remove(vrFilterMesh);
        vrFilterMesh.geometry.dispose();
        vrFilterMesh.material.dispose();
        vrFilterMesh = null;
    }
    if (window.app.mainScene.fog) window.app.mainScene.fog.density = 0;

    // Kamera & Controls wiederherstellen
    camera.position.copy(savedCameraState.pos);
    if (window.app.mainControls) {
        window.app.mainControls.target.copy(savedCameraState.target);
        window.app.mainControls.enabled = true;
        window.app.mainControls.update();
    }

    if (document.fullscreenElement) document.exitFullscreen().catch(()=>{});
    else if (document.webkitFullscreenElement) document.webkitExitFullscreen().catch(()=>{});
    if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();

    const overlay = document.getElementById('vr-overlay');
    if (overlay) overlay.style.display = 'none';
    
    document.body.className = document.body.className.replace(/sim-[^\s]+/g, '').trim();
    
    toggleMainUI(true);
    window.dispatchEvent(new Event('resize'));
}

window.addEventListener('resize', () => {
    if (isActive && window.app.mainCamera && window.app.renderer) {
        window.app.mainCamera.aspect = window.innerWidth / window.innerHeight;
        window.app.mainCamera.updateProjectionMatrix();
        window.app.renderer.setSize(window.innerWidth, window.innerHeight);
    }
});