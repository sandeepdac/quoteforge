import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { 
  RotateCcw, 
  Eye, 
  Box, 
  Layers, 
  Maximize2,
  Minimize2,
  Sparkles,
  Ruler,
  Crosshair,
  Sun,
  Moon,
  CheckCircle,
  HelpCircle
} from 'lucide-react';
import { StepParseResult } from '../../utils/stepParser';
import { TessellatedMesh } from '../../utils/occtLoader';
import { cameraBracketFor, zoomLimitsFor, CAMERA_OFFSET } from '../../utils/viewerCamera';

interface CadViewer3DProps {
  cadData: StepParseResult;
  selectedMaterialName?: string;
  stepMesh?: TessellatedMesh;
  className?: string;
}

type MeshStatus = 'idle' | 'ready' | 'fallback';

/** Builds a camera-facing text label (rounded pill) as a THREE.Sprite. */
function makeTextSprite(text: string, colorCss: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const measureCtx = canvas.getContext('2d')!;
  const fontSize = 48;
  const font = `bold ${fontSize}px ui-monospace, monospace`;
  measureCtx.font = font;
  const textW = Math.ceil(measureCtx.measureText(text).width);
  canvas.width = textW + 36;
  canvas.height = fontSize + 26;

  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  const r = 12;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(canvas.width, 0, canvas.width, canvas.height, r);
  ctx.arcTo(canvas.width, canvas.height, 0, canvas.height, r);
  ctx.arcTo(0, canvas.height, 0, 0, r);
  ctx.arcTo(0, 0, canvas.width, 0, r);
  ctx.closePath();
  ctx.fillStyle = 'rgba(15,23,42,0.82)';
  ctx.fill();
  ctx.strokeStyle = colorCss;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = colorCss;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true })
  );
  sprite.userData.aspect = canvas.width / canvas.height;
  return sprite;
}

export default function CadViewer3D({ cadData, selectedMaterialName, stepMesh, className = '' }: CadViewer3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [isWireframe, setIsWireframe] = useState(false);
  const [showBoundingBox, setShowBoundingBox] = useState(true);
  const [showHoles, setShowHoles] = useState(true);
  const [showDimensions, setShowDimensions] = useState(true);
  const [theme, setTheme] = useState<'blueprint' | 'metal' | 'dark'>('blueprint');
  const [isAutoRotate, setIsAutoRotate] = useState(true);
  const [measurementMode, setMeasurementMode] = useState(false);
  const [measuredDistance, setMeasuredDistance] = useState<number | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  // Refs used by the click-to-measure tool (read inside the render effect without
  // forcing a scene rebuild on every toggle).
  const measurementModeRef = useRef(false);
  const measurePointsRef = useRef<THREE.Vector3[]>([]);
  const measureGroupRef = useRef<THREE.Group | null>(null);
  const mainMeshRef = useRef<THREE.Mesh | null>(null);

  const clearMeasurement = () => {
    const g = measureGroupRef.current;
    if (g) while (g.children.length) g.remove(g.children[0]);
    measurePointsRef.current = [];
    setMeasuredDistance(null);
  };

  // Keep the ref in sync and reset picks when measurement is switched off.
  useEffect(() => {
    measurementModeRef.current = measurementMode;
    if (!measurementMode) clearMeasurement();
    if (measurementMode) setIsAutoRotate(false); // stop spin so points don't move
  }, [measurementMode]);

  // Collapse fullscreen on Escape.
  useEffect(() => {
    if (!isExpanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsExpanded(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isExpanded]);

  // Build a three.js geometry from the pre-tessellated B-Rep mesh (produced during
  // extraction). No re-computation here — the viewer just consumes the mesh.
  const realGeometry = useMemo(() => {
    if (!stepMesh) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(stepMesh.positions, 3));
    if (stepMesh.hasNormals) {
      geometry.setAttribute('normal', new THREE.BufferAttribute(stepMesh.normals, 3));
    }
    geometry.setIndex(new THREE.BufferAttribute(stepMesh.indices, 1));
    if (!stepMesh.hasNormals) geometry.computeVertexNormals();

    // Center the model on the origin so the existing camera framing works.
    geometry.computeBoundingBox();
    const center = new THREE.Vector3();
    geometry.boundingBox!.getCenter(center);
    geometry.translate(-center.x, -center.y, -center.z);
    return geometry;
  }, [stepMesh]);

  const meshStatus: MeshStatus = realGeometry ? 'ready' : 'fallback';

  // Real per-axis bounding-box extents (mm) of what's actually rendered — used for
  // both the on-canvas dimension overlay and the summary panel.
  const axisDims = useMemo(() => {
    if (realGeometry) {
      realGeometry.computeBoundingBox();
      const b = realGeometry.boundingBox!;
      const r1 = (n: number) => Math.round(n * 10) / 10;
      return { x: r1(b.max.x - b.min.x), y: r1(b.max.y - b.min.y), z: r1(b.max.z - b.min.z) };
    }
    return { x: cadData.lengthMm, y: cadData.heightMm, z: cadData.widthMm };
  }, [realGeometry, cadData]);

  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const objectGroupRef = useRef<THREE.Group | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!mountRef.current) return;

    const width = mountRef.current.clientWidth;
    const height = mountRef.current.clientHeight || 360;

    // 1. Scene Setup
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    if (theme === 'blueprint') {
      scene.background = new THREE.Color('#0b1329');
    } else if (theme === 'dark') {
      scene.background = new THREE.Color('#09090b');
    } else {
      scene.background = new THREE.Color('#f4f4f5');
    }

    // Everything below is sized from what is ACTUALLY on screen. These used to be
    // fixed millimetre constants (a 600 mm grid, a 2000 mm far plane, a 100–1200 mm
    // zoom range), which silently broke on large parts: an 800 mm plate puts the
    // camera ~2360 mm out, past the old far plane, so the model was clipped away to
    // a sliver. Scaling by the model span keeps any part framed the same way.
    const modelSpan = Math.max(axisDims.x, axisDims.y, axisDims.z) || 300;

    // Grid helper
    const gridColor = theme === 'blueprint' ? '#1e293b' : '#3f3f46';
    const gridSpan = Math.max(600, modelSpan * 2);
    const gridHelper = new THREE.GridHelper(gridSpan, 30, new THREE.Color(gridColor), new THREE.Color(gridColor));
    gridHelper.position.y = -axisDims.y / 2 - modelSpan * 0.06;
    scene.add(gridHelper);

    // 2. Camera Setup
    // Near/far bracket the model rather than being fixed: the camera sits ~3×
    // the span away, so the far plane must clear that plus the part itself, with
    // headroom for zooming out.
    // Frame slightly wider when dimension annotations are shown so their labels fit.
    const frame = showDimensions ? 1.12 : 1.0;
    const bracket = cameraBracketFor(modelSpan, frame);
    const camera = new THREE.PerspectiveCamera(45, width / height, bracket.near, bracket.far);
    camera.position.set(
      modelSpan * CAMERA_OFFSET.x * frame,
      modelSpan * CAMERA_OFFSET.y * frame,
      modelSpan * CAMERA_OFFSET.z * frame
    );
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // 3. Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, theme === 'blueprint' ? 0.7 : 0.9);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight1.position.set(200, 400, 300);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x38bdf8, 0.8);
    dirLight2.position.set(-200, -200, -200);
    scene.add(dirLight2);

    // 4. Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 5. Build 3D CAD Geometry Group
    const objectGroup = new THREE.Group();
    objectGroupRef.current = objectGroup;

    const { lengthMm, widthMm, heightMm } = cadData;
    const thickness = heightMm < 12 ? Math.max(1.5, heightMm) : 3.0;

    // Material Styling
    let cadMaterial: THREE.Material;

    if (theme === 'blueprint') {
      cadMaterial = new THREE.MeshStandardMaterial({
        color: 0x0284c7,
        metalness: 0.3,
        roughness: 0.2,
        wireframe: isWireframe,
        side: THREE.DoubleSide
      });
    } else if (theme === 'metal') {
      cadMaterial = new THREE.MeshStandardMaterial({
        color: 0xcbd5e1,
        metalness: 0.85,
        roughness: 0.25,
        wireframe: isWireframe,
        side: THREE.DoubleSide
      });
    } else {
      cadMaterial = new THREE.MeshStandardMaterial({
        color: 0x3b82f6,
        metalness: 0.5,
        roughness: 0.3,
        wireframe: isWireframe,
        side: THREE.DoubleSide
      });
    }

    const edgeColor = theme === 'blueprint' ? 0x38bdf8 : 0x0284c7;
    const lineMat = new THREE.LineBasicMaterial({ color: edgeColor, linewidth: 2 });

    if (realGeometry) {
      // ---- Exact tessellated B-Rep from the STEP solid ----
      const mainMesh = new THREE.Mesh(realGeometry, cadMaterial);
      objectGroup.add(mainMesh);
      mainMeshRef.current = mainMesh;

      // Real CAD edges derived from the actual faces (feature-angle filtered).
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(realGeometry, 20), lineMat);
      objectGroup.add(edges);
    } else {
      // ---- Schematic fallback: representative sheet-metal box + flanges + hole markers ----
      const boxGeo = new THREE.BoxGeometry(lengthMm, thickness, widthMm, 8, 2, 8);
      const mainMesh = new THREE.Mesh(boxGeo, cadMaterial);
      objectGroup.add(mainMesh);
      mainMeshRef.current = mainMesh;

      const edgesGeo = new THREE.EdgesGeometry(boxGeo);
      const lineSegments = new THREE.LineSegments(edgesGeo, lineMat);
      objectGroup.add(lineSegments);

      // Add Bent Flanges if bend count > 0
      if (cadData.bendCount > 0) {
        const flangeHeight = Math.min(60, cadData.heightMm > 15 ? cadData.heightMm : 40);

        // Top Flange
        const flangeGeo1 = new THREE.BoxGeometry(lengthMm, flangeHeight, thickness);
        const flangeMesh1 = new THREE.Mesh(flangeGeo1, cadMaterial);
        flangeMesh1.position.set(0, flangeHeight / 2 - thickness / 2, widthMm / 2 - thickness / 2);
        objectGroup.add(flangeMesh1);

        const edgeFlange1 = new THREE.LineSegments(new THREE.EdgesGeometry(flangeGeo1), lineMat);
        edgeFlange1.position.copy(flangeMesh1.position);
        objectGroup.add(edgeFlange1);

        // Bottom Flange
        const flangeGeo2 = new THREE.BoxGeometry(lengthMm, flangeHeight, thickness);
        const flangeMesh2 = new THREE.Mesh(flangeGeo2, cadMaterial);
        flangeMesh2.position.set(0, flangeHeight / 2 - thickness / 2, -widthMm / 2 + thickness / 2);
        objectGroup.add(flangeMesh2);

        const edgeFlange2 = new THREE.LineSegments(new THREE.EdgesGeometry(flangeGeo2), lineMat);
        edgeFlange2.position.copy(flangeMesh2.position);
        objectGroup.add(edgeFlange2);
      }
    }

    // Add Cylindrical Hole Markers (schematic only — real geometry already has holes)
    if (showHoles && !realGeometry) {
      cadData.holeDetails.forEach((hole, idx) => {
        const radius = Math.max(2, hole.diameterMm / 2);
        const cylGeo = new THREE.CylinderGeometry(radius, radius, thickness * 1.8, 16);
        const holeMat = new THREE.MeshStandardMaterial({
          color: 0xef4444,
          metalness: 0.1,
          roughness: 0.1,
          wireframe: false
        });

        // Distribute holes neatly
        const stepX = (lengthMm * 0.7) / Math.max(1, hole.count);
        for (let i = 0; i < hole.count; i++) {
          const holeMesh = new THREE.Mesh(cylGeo, holeMat);
          const posX = -lengthMm * 0.35 + i * stepX + (idx * 15);
          const posZ = (i % 2 === 0 ? 1 : -1) * (widthMm * 0.3);
          holeMesh.position.set(posX, 0, posZ);
          objectGroup.add(holeMesh);

          // Add hole rim circle
          const rimGeo = new THREE.RingGeometry(radius, radius + 1, 32);
          const rimMat = new THREE.MeshBasicMaterial({ color: 0xf87171, side: THREE.DoubleSide });
          const rimMesh = new THREE.Mesh(rimGeo, rimMat);
          rimMesh.rotation.x = Math.PI / 2;
          rimMesh.position.set(posX, thickness / 2 + 0.1, posZ);
          objectGroup.add(rimMesh);
        }
      });
    }

    // Add Bounding Box Outline
    if (showBoundingBox) {
      const bboxGeo = new THREE.BoxGeometry(lengthMm + 4, Math.max(heightMm, 30) + 4, widthMm + 4);
      const bboxMat = new THREE.LineDashedMaterial({
        color: 0xf59e0b,
        dashSize: 6,
        gapSize: 4
      });
      const bboxLines = new THREE.LineSegments(new THREE.EdgesGeometry(bboxGeo), bboxMat);
      bboxLines.computeLineDistances();
      objectGroup.add(bboxLines);
    }

    // Add 3D dimension annotations (dimension lines + camera-facing labels) along
    // each axis of the actual geometry, so the size reads directly off the model.
    if (showDimensions) {
      const dx = axisDims.x, dy = axisDims.y, dz = axisDims.z;
      const hx = dx / 2, hy = dy / 2, hz = dz / 2;
      const maxD = Math.max(dx, dy, dz) || 100;
      const off = maxD * 0.06;
      const tickLen = maxD * 0.025;
      const labelH = maxD * 0.1;

      const addDim = (
        a: THREE.Vector3,
        b: THREE.Vector3,
        tickDir: THREE.Vector3,
        label: string,
        hex: number,
        css: string
      ) => {
        const mat = new THREE.LineBasicMaterial({ color: hex, depthTest: false, transparent: true });
        objectGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), mat));
        const td = tickDir.clone().multiplyScalar(tickLen);
        objectGroup.add(
          new THREE.LineSegments(
            new THREE.BufferGeometry().setFromPoints([
              a.clone().add(td), a.clone().sub(td),
              b.clone().add(td), b.clone().sub(td),
            ]),
            mat
          )
        );
        const sprite = makeTextSprite(label, css);
        const aspect = (sprite.userData.aspect as number) || 3;
        sprite.scale.set(labelH * aspect, labelH, 1);
        sprite.position.copy(
          a.clone().add(b).multiplyScalar(0.5).add(tickDir.clone().multiplyScalar(tickLen * 2.4))
        );
        objectGroup.add(sprite);
      };

      const V = THREE.Vector3;
      // X (red), Y (green), Z (blue) — labelled with the real extent along that axis.
      addDim(new V(-hx, -hy - off, hz), new V(hx, -hy - off, hz), new V(0, 1, 0), `${dx} mm`, 0xf87171, '#f87171');
      addDim(new V(hx + off, -hy, hz), new V(hx + off, hy, hz), new V(1, 0, 0), `${dy} mm`, 0x4ade80, '#4ade80');
      addDim(new V(hx, -hy - off, -hz), new V(hx, -hy - off, hz), new V(0, 1, 0), `${dz} mm`, 0x60a5fa, '#60a5fa');
    }

    // Group that holds measurement markers/lines so they rotate WITH the model.
    const measureGroup = new THREE.Group();
    objectGroup.add(measureGroup);
    measureGroupRef.current = measureGroup;

    scene.add(objectGroup);

    // Mouse Controls (Simple Orbit Drag)
    let isDragging = false;
    let previousMousePosition = { x: 0, y: 0 };

    const domElem = mountRef.current;
    const raycaster = new THREE.Raycaster();

    // Click-to-measure: pick two surface points; the straight-line distance
    // between them (in mm) is shown. A third click starts a fresh measurement.
    const handleMeasureClick = (e: MouseEvent) => {
      if (!cameraRef.current || !mainMeshRef.current || !measureGroupRef.current) return;
      const rect = domElem.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(ndc, cameraRef.current);
      const hits = raycaster.intersectObject(mainMeshRef.current, true);
      if (!hits.length) return;
      const local = objectGroup.worldToLocal(hits[0].point.clone());
      if (measurePointsRef.current.length >= 2) clearMeasurement();
      measurePointsRef.current.push(local);

      const dotGeo = new THREE.SphereGeometry(Math.max(1.2, (Math.max(axisDims.x, axisDims.y, axisDims.z) || 100) * 0.008), 12, 12);
      const dot = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: 0xf59e0b, depthTest: false }));
      dot.position.copy(local);
      measureGroupRef.current.add(dot);

      if (measurePointsRef.current.length === 2) {
        const [a, b] = measurePointsRef.current;
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([a, b]),
          new THREE.LineBasicMaterial({ color: 0xf59e0b, depthTest: false })
        );
        measureGroupRef.current.add(line);
        setMeasuredDistance(a.distanceTo(b));
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (measurementModeRef.current) { handleMeasureClick(e); return; } // pick, don't rotate
      isDragging = true;
      previousMousePosition = { x: e.clientX, y: e.clientY };
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !objectGroupRef.current) return;

      const deltaMove = {
        x: e.clientX - previousMousePosition.x,
        y: e.clientY - previousMousePosition.y
      };

      objectGroupRef.current.rotation.y += deltaMove.x * 0.008;
      objectGroupRef.current.rotation.x += deltaMove.y * 0.008;

      previousMousePosition = { x: e.clientX, y: e.clientY };
    };

    const handleMouseUp = () => {
      isDragging = false;
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!cameraRef.current) return;
      // Zoom step and limits scale with the part, so the wheel feels the same on a
      // 20 mm bracket and an 800 mm plate. Fixed limits used to snap a large part
      // to a hard stop on the first scroll.
      const z = zoomLimitsFor(modelSpan);
      cameraRef.current.position.z += e.deltaY * z.step;
      cameraRef.current.position.z = Math.max(z.min, Math.min(z.max, cameraRef.current.position.z));
    };

    domElem.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    domElem.addEventListener('wheel', handleWheel, { passive: false });

    // Animation Loop
    const animate = () => {
      animationFrameRef.current = requestAnimationFrame(animate);

      if (objectGroupRef.current && isAutoRotate && !isDragging && !measurementModeRef.current) {
        objectGroupRef.current.rotation.y += 0.005;
      }

      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };

    animate();

    // Resize Handler
    const handleResize = () => {
      if (!mountRef.current || !rendererRef.current || !cameraRef.current) return;
      const w = mountRef.current.clientWidth;
      const h = mountRef.current.clientHeight || 360;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    // Keep the canvas synced to its CONTAINER, not just the window — the panel's
    // width settles after layout/animation and on expand, and a stale width is
    // what leaves the model crammed to one side with empty space beside it.
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(domElem);
    // Re-measure on the next frame too, in case the first measure was pre-layout.
    requestAnimationFrame(handleResize);

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      domElem.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      domElem.removeEventListener('wheel', handleWheel);

      if (rendererRef.current && rendererRef.current.domElement) {
        domElem.removeChild(rendererRef.current.domElement);
      }
    };
  }, [cadData, theme, isWireframe, showBoundingBox, showHoles, showDimensions, isAutoRotate, realGeometry, axisDims, isExpanded]);

  const handleResetView = () => {
    if (objectGroupRef.current) {
      objectGroupRef.current.rotation.set(0.3, -0.4, 0);
    }
  };

  return (
    <div className={
      isExpanded
        ? 'fixed inset-0 z-50 bg-card flex flex-col'
        : `relative rounded-xl border border-border overflow-hidden bg-card flex flex-col ${className}`
    }>
      {/* CAD Toolbar */}
      <div className="bg-slate-900/90 backdrop-blur-md px-4 py-2.5 flex flex-wrap items-center justify-between gap-y-2 border-b border-slate-800 text-slate-200 text-xs">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 font-bold text-sky-400">
            <Box size={16} />
            <span>3D CAD STEP Viewer</span>
          </div>
          <span className="bg-slate-800 text-slate-400 px-2 py-0.5 rounded text-[10px] font-mono">
            {cadData.fileName}
          </span>
          {meshStatus === 'ready' && (
            <span className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
              <CheckCircle size={11} /> Exact B-Rep
            </span>
          )}
          {meshStatus === 'fallback' && (
            <span className="bg-slate-700 text-slate-300 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider" title="Could not tessellate the STEP solid; showing a representative schematic.">
              Schematic
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsWireframe(!isWireframe)}
            className={`px-2.5 py-1 rounded text-[11px] font-medium flex items-center gap-1 transition-colors ${
              isWireframe ? 'bg-sky-500 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
            }`}
            title="Toggle Wireframe Mode"
          >
            <Layers size={13} />
            Wireframe
          </button>

          <button
            onClick={() => setShowBoundingBox(!showBoundingBox)}
            className={`px-2.5 py-1 rounded text-[11px] font-medium flex items-center gap-1 transition-colors ${
              showBoundingBox ? 'bg-amber-500 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
            }`}
            title="Toggle Bounding Box"
          >
            <Box size={13} />
            BBox
          </button>

          <button
            onClick={() => setShowDimensions(!showDimensions)}
            className={`px-2.5 py-1 rounded text-[11px] font-medium flex items-center gap-1 transition-colors ${
              showDimensions ? 'bg-sky-500 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
            }`}
            title="Toggle Dimensions"
          >
            <Ruler size={13} />
            Dims
          </button>

          <button
            onClick={() => setMeasurementMode(!measurementMode)}
            className={`px-2.5 py-1 rounded text-[11px] font-medium flex items-center gap-1 transition-colors ${
              measurementMode ? 'bg-amber-500 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
            }`}
            title="Measure distance between two points on the model"
          >
            <Crosshair size={13} />
            Measure
          </button>

          <button
            onClick={() => setIsAutoRotate(!isAutoRotate)}
            className={`px-2.5 py-1 rounded text-[11px] font-medium flex items-center gap-1 transition-colors ${
              isAutoRotate ? 'bg-emerald-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
            }`}
            title="Auto Rotate 3D Model"
          >
            <RotateCcw size={13} className={isAutoRotate ? 'animate-spin' : ''} />
            Spin
          </button>

          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="px-2.5 py-1 rounded text-[11px] font-medium flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            title={isExpanded ? 'Collapse viewer' : 'Expand viewer to full screen'}
          >
            {isExpanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            {isExpanded ? 'Close' : 'Expand'}
          </button>

          <div className="h-4 w-px bg-slate-700 mx-1"></div>

          <div className="flex items-center gap-1 bg-slate-800 p-0.5 rounded">
            <button
              onClick={() => setTheme('blueprint')}
              className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                theme === 'blueprint' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Blueprint
            </button>
            <button
              onClick={() => setTheme('metal')}
              className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                theme === 'metal' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Metal
            </button>
          </div>
        </div>
      </div>

      {/* 3D WebGL Canvas Area */}
      <div
        ref={mountRef}
        className={`w-full relative select-none ${isExpanded ? 'flex-1' : 'h-[360px]'} ${measurementMode ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`}
      >
        {/* Dimension Callouts Overlay */}
        {showDimensions && (
          <div className="absolute bottom-3 left-3 bg-slate-900/80 backdrop-blur-md border border-slate-800 text-slate-200 p-3 rounded-lg text-xs space-y-1 font-mono shadow-xl pointer-events-none">
            <div className="text-[10px] font-bold text-sky-400 uppercase tracking-wider mb-1 flex items-center gap-1">
              <Ruler size={12} />
              CAD Bounding Dimensions
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-slate-800/80 p-1.5 rounded border border-slate-700">
                <span className="text-[10px] text-red-400 block">X</span>
                <span className="font-bold text-white text-sm">{axisDims.x} mm</span>
              </div>
              <div className="bg-slate-800/80 p-1.5 rounded border border-slate-700">
                <span className="text-[10px] text-emerald-400 block">Y</span>
                <span className="font-bold text-white text-sm">{axisDims.y} mm</span>
              </div>
              <div className="bg-slate-800/80 p-1.5 rounded border border-slate-700">
                <span className="text-[10px] text-sky-400 block">Z</span>
                <span className="font-bold text-white text-sm">{axisDims.z} mm</span>
              </div>
            </div>
          </div>
        )}

        {/* Feature Counters Overlay */}
        <div className="absolute top-3 right-3 flex flex-col gap-1.5 items-end">
          <div className="bg-slate-900/80 backdrop-blur-md border border-slate-800 text-slate-200 px-3 py-1.5 rounded-md text-[11px] font-medium flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
            <span>Holes: <strong className="text-white">{cadData.holeCount}</strong></span>
          </div>

          <div className="bg-slate-900/80 backdrop-blur-md border border-slate-800 text-slate-200 px-3 py-1.5 rounded-md text-[11px] font-medium flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-amber-500"></div>
            <span>Bends: <strong className="text-white">{cadData.bendCount}</strong></span>
          </div>

          <div className="bg-slate-900/80 backdrop-blur-md border border-slate-800 text-slate-200 px-3 py-1.5 rounded-md text-[11px] font-medium flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
            <span>Vol: <strong className="text-white">{cadData.volumeCm3} cm³</strong></span>
          </div>
        </div>

        {/* Measurement panel */}
        {measurementMode && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-amber-500/15 border border-amber-500/40 backdrop-blur-md text-amber-100 px-4 py-2 rounded-lg text-xs shadow-xl flex items-center gap-3">
            <Crosshair size={14} className="text-amber-400" />
            {measuredDistance != null ? (
              <span>Distance: <strong className="text-white font-mono text-sm">{measuredDistance.toFixed(2)} mm</strong> <span className="text-amber-200/70">· click to start a new measurement</span></span>
            ) : (
              <span>{measurePointsRef.current.length === 1 ? 'Click the second point…' : 'Click two points on the model to measure'}</span>
            )}
          </div>
        )}

        {/* Drag Guidance */}
        <div className="absolute bottom-3 right-3 text-[10px] text-slate-400 bg-slate-900/60 px-2.5 py-1 rounded backdrop-blur">
          {measurementMode ? 'Click points to Measure | Scroll to Zoom' : 'Click & Drag to Rotate | Scroll to Zoom'}
        </div>
      </div>
    </div>
  );
}
