import * as THREE from "three";
import { VRButton } from "VRButton";
import { DeviceOrientationControls } from "DeviceOrientationControls";

let vrControls = null;
let isActive = false;
let savedCameraState = { pos: new THREE.Vector3(), target: new THREE.Vector3() };

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

// Sauberes UI-Management (Verhindert Popup-Chaos!)
function toggleMainUI(show) {
    const uiLayer = document.getElementById('ui-layer');
    const homeScreen = document.getElementById('homescreen');
    const overlay = document.getElementById('modal-overlay');
    const scenarioLayer = document.getElementById('scenario-ui-layer');
    
    if (show) {
        // Beim Beenden leiten wir sicher zum Homescreen (SensAble Lab) zurück
        if (window.app && typeof window.app.goHome === 'function') {
            window.app.goHome(); 
        } else {
            if(homeScreen) homeScreen.style.display = 'flex';
        }
        if(overlay) overlay.classList.remove('active');
    } else {
        // Vor dem VR Start alles ausblenden
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
        
        if (screen.orientation && screen.orientation.lock) {
            await screen.orientation.lock('landscape').catch(()=>{}); 
        }
    } catch (err) {
        console.warn("Fullscreen/Orientation lock failed. Eventuell wegen Browser-Restriktionen.", err);
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
                document.body.className = document.body.className.replace(/sim-[^\s]+/g, '').trim();
                const filterStr = e.target.getAttribute('data-filter');
                if (filterStr !== 'none') {
                    const filters = filterStr.split(' ');
                    filters.forEach(f => document.body.classList.add(f));
                }
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

export async function startVRMode() {
    try {
        if (isActive) return;
        
        // 1. Sichere Engine-Initialisierung (Falls Nutzer direkt im Lab klickt)
        if (!window.app || !window.app.renderer || !window.app.mainScene) {
            if (window.app && typeof window.app.initEngine === 'function') {
                showVRLoader(true, 'Starte 3D Engine im Hintergrund...');
                window.app.initEngine();
                // Kurz warten, bis der Raum geladen ist
                await new Promise(resolve => setTimeout(resolve, 1500)); 
            } else {
                alert("Fehler: Engine nicht bereit.");
                return;
            }
        }
        
        showVRLoader(true, 'VR/360° Modus wird initialisiert...');
        
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            try {
                await Promise.race([
                    DeviceOrientationEvent.requestPermission(),
                    new Promise(resolve => setTimeout(() => resolve('timeout'), 1500))
                ]);
            } catch (error) {
                console.warn('Gyroskop-Fehler:', error);
            }
        }

        enterFullscreenAndLandscape().catch(e => console.warn(e));

        const renderer = window.app.renderer;
        const camera = window.app.mainCamera;
        
        renderer.xr.enabled = true;
        
        // 2. Kamera- & Steuerungszustand für das Beenden sichern
        savedCameraState.pos.copy(camera.position);
        if (window.app.mainControls) {
            savedCameraState.target.copy(window.app.mainControls.target);
            window.app.mainControls.enabled = false; // Planer-Steuerung sperren
        }

        // 3. Perspektive exakt auf den Avatar setzen (oder Raummitte als Fallback)
        let startPos = new THREE.Vector3(0, 1.62, 0);
        window.app.mainScene.traverse((child) => {
            if (child.userData && child.userData.isAvatar) {
                startPos.copy(child.position);
                startPos.y += 1.62; // Exakte Visier-Höhe deines Avatars
            }
        });
        camera.position.copy(startPos);

        // 4. Gyroskop aktivieren
        try {
            vrControls = new DeviceOrientationControls(camera);
        } catch(e) {
            console.warn("DeviceOrientationControls Fehler (Fallback auf statische Kamera):", e);
            vrControls = null;
        }

        // 5. UI umschalten
        toggleMainUI(false);
        const overlay = document.getElementById('vr-overlay');
        if (overlay) overlay.style.display = 'block';

        initOverlayListeners();

        // 6. Eigener Render-Loop auf Basis der HAUPT-Szene!
        const renderVR = () => {
            if (vrControls && !renderer.xr.isPresenting) {
                vrControls.update();
            }
            renderer.render(window.app.mainScene, camera);
        };

        renderer.setAnimationLoop(renderVR);
        isActive = true;
        
        // 7. WebXR Button Injection
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

            // Verstecke den Button, falls das Gerät (Desktop) kein Headset hat
            setTimeout(() => {
                const btn = document.getElementById('webxr-btn');
                if (btn && (btn.disabled || btn.innerText.toLowerCase().includes('supported'))) {
                    btn.style.display = 'none';
                }
            }, 3000);
        } catch(e) { console.error("VRButton Error:", e); }

        showVRLoader(false);

    } catch(globalError) {
        console.error("Kritischer Fehler beim Starten des VR-Modus:", globalError);
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

    // Loop zurück an den Haupt-Planer übergeben
    renderer.setAnimationLoop(window.app.mainAnimate);
    
    if (vrControls) {
        vrControls.dispose();
        vrControls = null;
    }

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
    
    // VR CSS Filter zurücksetzen
    document.body.className = document.body.className.replace(/sim-[^\s]+/g, '').trim();
    
    // UI wiederherstellen (Homescreen)
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