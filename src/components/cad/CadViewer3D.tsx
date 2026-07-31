import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { 
  RotateCcw, 
  Eye, 
  Box, 
  Layers, 
  Maximize2, 
  Sparkles, 
  Ruler, 
  Sun, 
  Moon,
  CheckCircle,
  HelpCircle
} from 'lucide-react';
import { StepParseResult } from '../../utils/stepParser';
import { TessellatedMesh } from '../../utils/occtLoader';

interface CadViewer3DProps {
  cadData: StepParseResult;
  selectedMaterialName?: string;
  stepMesh?: TessellatedMesh;
  className?: string;
}

type MeshStatus = 'idle' | 'ready' | 'fallback';

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

    // Grid helper
    const gridColor = theme === 'blueprint' ? '#1e293b' : '#3f3f46';
    const gridHelper = new THREE.GridHelper(600, 30, new THREE.Color(gridColor), new THREE.Color(gridColor));
    gridHelper.position.y = -cadData.heightMm / 2 - 20;
    scene.add(gridHelper);

    // 2. Camera Setup
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2000);
    const maxDim = Math.max(cadData.lengthMm, cadData.widthMm, cadData.heightMm) || 300;
    camera.position.set(maxDim * 1.5, maxDim * 1.2, maxDim * 1.8);
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

      // Real CAD edges derived from the actual faces (feature-angle filtered).
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(realGeometry, 20), lineMat);
      objectGroup.add(edges);
    } else {
      // ---- Schematic fallback: representative sheet-metal box + flanges + hole markers ----
      const boxGeo = new THREE.BoxGeometry(lengthMm, thickness, widthMm, 8, 2, 8);
      const mainMesh = new THREE.Mesh(boxGeo, cadMaterial);
      objectGroup.add(mainMesh);

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

    scene.add(objectGroup);

    // Mouse Controls (Simple Orbit Drag)
    let isDragging = false;
    let previousMousePosition = { x: 0, y: 0 };

    const domElem = mountRef.current;

    const handleMouseDown = (e: MouseEvent) => {
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
      cameraRef.current.position.z += e.deltaY * 0.5;
      cameraRef.current.position.z = Math.max(100, Math.min(1200, cameraRef.current.position.z));
    };

    domElem.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    domElem.addEventListener('wheel', handleWheel, { passive: false });

    // Animation Loop
    const animate = () => {
      animationFrameRef.current = requestAnimationFrame(animate);

      if (objectGroupRef.current && isAutoRotate && !isDragging) {
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

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      window.removeEventListener('resize', handleResize);
      domElem.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      domElem.removeEventListener('wheel', handleWheel);

      if (rendererRef.current && rendererRef.current.domElement) {
        domElem.removeChild(rendererRef.current.domElement);
      }
    };
  }, [cadData, theme, isWireframe, showBoundingBox, showHoles, isAutoRotate, realGeometry]);

  const handleResetView = () => {
    if (objectGroupRef.current) {
      objectGroupRef.current.rotation.set(0.3, -0.4, 0);
    }
  };

  return (
    <div className={`relative rounded-xl border border-border overflow-hidden bg-card flex flex-col ${className}`}>
      {/* CAD Toolbar */}
      <div className="bg-slate-900/90 backdrop-blur-md px-4 py-2.5 flex items-center justify-between border-b border-slate-800 text-slate-200 text-xs">
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
            onClick={() => setIsAutoRotate(!isAutoRotate)}
            className={`px-2.5 py-1 rounded text-[11px] font-medium flex items-center gap-1 transition-colors ${
              isAutoRotate ? 'bg-emerald-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
            }`}
            title="Auto Rotate 3D Model"
          >
            <RotateCcw size={13} className={isAutoRotate ? 'animate-spin' : ''} />
            Spin
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
        className="w-full h-[360px] relative cursor-grab active:cursor-grabbing select-none"
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
                <span className="text-[10px] text-slate-400 block">Length X</span>
                <span className="font-bold text-white text-sm">{cadData.lengthMm} mm</span>
              </div>
              <div className="bg-slate-800/80 p-1.5 rounded border border-slate-700">
                <span className="text-[10px] text-slate-400 block">Width Y</span>
                <span className="font-bold text-white text-sm">{cadData.widthMm} mm</span>
              </div>
              <div className="bg-slate-800/80 p-1.5 rounded border border-slate-700">
                <span className="text-[10px] text-slate-400 block">Height Z</span>
                <span className="font-bold text-white text-sm">{cadData.heightMm} mm</span>
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

        {/* Drag Guidance */}
        <div className="absolute bottom-3 right-3 text-[10px] text-slate-400 bg-slate-900/60 px-2.5 py-1 rounded backdrop-blur">
          Click & Drag to Rotate | Scroll to Zoom
        </div>
      </div>
    </div>
  );
}
