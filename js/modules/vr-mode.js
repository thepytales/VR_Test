import * as THREE from "three";
import { VRButton } from "VRButton";
import { DeviceOrientationControls } from "DeviceOrientationControls";
import { GLTFLoader } from "GLTFLoader";
import { DRACOLoader } from "DRACOLoader";

let vrScene = null;
let vrCamera = null;
let vrControls = null;
let isActive = false;

// Fixe Raum-Konfiguration für das SensAble Lab
const vrRoomConfig = {
    "room": "raummodell_leer.glb",
    "furniture": [
        {"typeId":"k6","exportId":"e93d407f","x":-1.94,"z":-1.59,"rot":0},
        {"typeId":"k6","exportId":"e9c980e3","x":2.06,"z":-1.31,"rot":0.78},
        {"typeId":"k6","exportId":"30122678","x":-1.95,"z":1.95,"rot":0.78},
        {"typeId":"k6","exportId":"66b4d1ff","x":1.95,"z":1.95,"rot":0},
        {"typeId":"board","exportId":"0c65ec5f","x":0,"z":-3.85,"rot":0}
    ]
};

// Modul-interner Ladebildschirm (Unabhängig von ui.js)
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

// Intelligentes Verstecken der Haupt-UI (ignoriert den Canvas-Container)
function toggleMainUI(show) {
    if (!window.app.renderer) return;
    const canvas = window.app.renderer.domElement;
    const children = document.body.children;
    
    for (let i = 0; i < children.length; i++) {
        const el = children[i];
        if (el.tagName !== 'SCRIPT' && el.id !== 'vr-overlay' && el.id !== 'main-vr-trigger' && el.id !== 'vr-local-loader' && !el.contains(canvas)) {
            if (show) {
                el.style.display = el.dataset.vrHiddenDisplay || '';
            } else {
                if (el.style.display !== 'none') {
                    el.dataset.vrHiddenDisplay = el.style.display;
                    el.style.display = 'none';
                }
            }
        }
    }
}

async function enterFullscreenAndLandscape() {
    const elem = document.documentElement;
    try {
        if (elem.requestFullscreen) await elem.requestFullscreen();
        else if (elem.webkitRequestFullscreen) await elem.webkitRequestFullscreen();
        
        if (screen.orientation && screen.orientation.lock) {
            await screen.orientation.lock('landscape');
        }
    } catch (err) {
        console.warn("Fullscreen/Orientation lock failed. Eventuell wegen iOS-Restriktionen.", err);
        const promptEl = document.getElementById('vr-landscape-prompt');
        if (promptEl) {
            promptEl.style.display = 'flex';
            setTimeout(() => { promptEl.style.display = 'none'; }, 4000);
        }
    }
}

// NEU: Asynchrones Laden mit Promise, damit wir warten können!
async function loadVRRoom() {
    return new Promise((resolve) => {
        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath('./lib/draco/');
        const gltfLoader = new GLTFLoader();
        gltfLoader.setDRACOLoader(dracoLoader);

        let loadedCount = 0;
        const totalItems = 1 + vrRoomConfig.furniture.length;

        const checkDone = () => {
            loadedCount++;
            if (loadedCount >= totalItems) {
                setTimeout(resolve, 300); // Kleiner Puffer für Textur-Upload an die GPU
            }
        };

        const loadModel = (filename, x, y, z, rot) => {
            gltfLoader.load(`./${filename}`, (gltf) => {
                const model = gltf.scene;
                model.position.set(x, y, z);
                model.rotation.y = rot;
                vrScene.add(model);
                checkDone();
            }, undefined, (error) => {
                console.error(`Fehler beim Laden von ${filename}:`, error);
                checkDone(); // Wir machen weiter, damit die App bei einem Fehler nicht ewig lädt
            });
        };

        // Raum laden
        loadModel(vrRoomConfig.room, 0, 0, 0, 0);

        // Möbel laden
        vrRoomConfig.furniture.forEach(item => {
            const filename = item.typeId.endsWith('.glb') ? item.typeId : `${item.typeId}.glb`;
            loadModel(filename, item.x, 0.22, item.z, item.rot);
        });
    });
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

function renderVR() {
    if (vrControls) vrControls.update();
    if (window.app.renderer && vrScene && vrCamera) {
        window.app.renderer.render(vrScene, vrCamera);
    }
}

export async function startVRMode() {
    if (isActive) return;
    
    // UI Blockieren & Loader zeigen
    showVRLoader(true, 'VR/360° Modus wird initialisiert...');
    
    // Gyroskop Berechtigung (iOS)
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        try {
            const permission = await DeviceOrientationEvent.requestPermission();
            if (permission !== 'granted') console.warn('Gyroskop-Berechtigung verweigert.');
        } catch (error) {
            console.error('Fehler bei der Gyroskop-Berechtigung:', error);
        }
    }

    // Fullscreen nicht blockierend
    enterFullscreenAndLandscape().catch(e => console.warn(e));

    const renderer = window.app.renderer;
    
    // VR-Szene aufbauen
    vrScene = new THREE.Scene();
    vrScene.background = new THREE.Color(0x111827);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    vrScene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
    dirLight.position.set(5, 10, 7);
    vrScene.add(dirLight);

    vrCamera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
    vrCamera.position.set(0, 1.62, 0); 

    vrControls = new DeviceOrientationControls(vrCamera);

    // Modelle asynchron laden ABER Minimum-Ladezeit erzwingen, damit kein Glitch entsteht
    showVRLoader(true, 'Lade 3D-Modelle für das SensAble Lab...');
    await Promise.all([
        loadVRRoom(),
        new Promise(resolve => setTimeout(resolve, 800)) // Zwinge den Loader mind. 800ms zu bleiben
    ]);

    // Alles bereit -> UI wechseln und Render-Loop umschalten
    toggleMainUI(false);
    document.getElementById('vr-overlay').style.display = 'block';
    
    const startBtn = document.getElementById('main-vr-trigger');
    if (startBtn) startBtn.style.display = 'none';

    initOverlayListeners();

    renderer.setAnimationLoop(renderVR);
    isActive = true;
    
    // WebXR Button für Headsets anfügen
    const vrBtn = VRButton.createButton(renderer);
    vrBtn.id = 'webxr-btn';
    vrBtn.style.position = 'absolute';
    vrBtn.style.bottom = '80px';
    vrBtn.style.left = '50%';
    vrBtn.style.transform = 'translateX(-50%)';
    vrBtn.style.pointerEvents = 'auto'; 
    document.getElementById('vr-overlay').appendChild(vrBtn);

    // NEU: Bugfix für hängende Browser-WebXR-APIs (verhindert ewiges "LOADING")
    setTimeout(() => {
        if (vrBtn && vrBtn.innerText.includes('LOADING')) {
            vrBtn.style.display = 'none'; // Verstecken!
            console.warn('WebXR API blockiert. Fallback auf reinen 360-Gyroskop-Modus.');
        }
    }, 2500);

    // Loader ausblenden
    showVRLoader(false);
}

export function stopVRMode() {
    if (!isActive) return;
    isActive = false;

    const vrBtn = document.getElementById('webxr-btn');
    if (vrBtn) vrBtn.remove();

    const renderer = window.app.renderer;
    renderer.setAnimationLoop(window.app.mainAnimate);

    vrScene.traverse((child) => {
        if (child.isMesh) {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
                else child.material.dispose();
            }
        }
    });
    
    vrControls.dispose();
    vrScene = null;
    vrCamera = null;
    vrControls = null;

    if (document.fullscreenElement) document.exitFullscreen().catch(()=>{});
    else if (document.webkitFullscreenElement) document.webkitExitFullscreen().catch(()=>{});
    
    if (screen.orientation && screen.orientation.unlock) {
        screen.orientation.unlock();
    }

    document.getElementById('vr-overlay').style.display = 'none';
    const startBtn = document.getElementById('main-vr-trigger');
    if (startBtn) startBtn.style.display = 'block';
    
    document.body.className = document.body.className.replace(/sim-[^\s]+/g, '').trim();
    
    toggleMainUI(true);
    window.dispatchEvent(new Event('resize'));
}

window.addEventListener('resize', () => {
    if (isActive && vrCamera && window.app.renderer) {
        vrCamera.aspect = window.innerWidth / window.innerHeight;
        vrCamera.updateProjectionMatrix();
        window.app.renderer.setSize(window.innerWidth, window.innerHeight);
    }
});