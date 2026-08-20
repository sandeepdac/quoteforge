/**
 * FACE COVERAGE — the part, painted by what the geometry engine understood.
 *
 * This is the one check in the product that can reveal a feature we never
 * detected. Everything else — tests, diagnostics, the cost breakdown — is
 * written from the analyser's own output, so it inherits the analyser's blind
 * spots: you cannot write an assertion about a ⌀24 bore unless you already know
 * the ⌀24 is there. Every geometry defect found so far was found by a person
 * looking at the part and asking where a feature had gone.
 *
 * So this does not draw markers on detected features (the old viewer did, which
 * is why a missed bore drew nothing and looked identical to a plain face). It
 * colours EVERY face by its classification, and paints the ones the engine could
 * not account for in red. An omission becomes something you can see.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { LabelledMesh, FACE_CLASS_INFO, faceClassOf } from '../../utils/geometryService';
import { cn } from '../../utils/cn';

interface Props {
  mesh: LabelledMesh | null;
  loading?: boolean;
  /** Rendered when the geometry service isn't available. */
  unavailableNote?: string;
}

export default function FaceCoverageViewer({ mesh, loading, unavailableNote }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  // Which classes are present, biggest area first — the legend is built from the
  // part in front of you, not from a fixed list of everything we might emit.
  const classes = useMemo(() => {
    if (!mesh) return [] as Array<{ key: string; faces: number; areaShare: number; detail: Record<string, number> }>;
    const rows = (mesh.faceLedger ?? []).map((r) => ({
      key: r.label, faces: r.faces, areaShare: r.areaShare, detail: r.detail ?? {},
    }));
    if (rows.length) return rows;
    const counts = new Map<string, number>();
    for (const l of Object.values(mesh.faceLabel)) {
      const k = faceClassOf(l);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return [...counts.entries()].map(([key, faces]) => ({ key, faces, areaShare: 0, detail: {} }));
  }, [mesh]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !mesh) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, mount.clientWidth / Math.max(1, mount.clientHeight), 0.1, 10000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(1, 1.4, 1);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.35);
    fill.position.set(-1, -0.6, -0.8);
    scene.add(fill);

    // Vertex colours carry the classification: one draw call, and every triangle
    // keeps the colour of the face it came from.
    const geom = new THREE.BufferGeometry();
    const pos = new Float32Array(mesh.positions);
    const colors = new Float32Array(pos.length);
    const idx = mesh.indices;
    const c = new THREE.Color();
    const skipped = new Set<number>();

    for (let t = 0; t < mesh.triangleFace.length; t++) {
      const fidx = mesh.triangleFace[t];
      const cls = faceClassOf(mesh.faceLabel[String(fidx)] ?? 'unexplained');
      if (hidden.has(cls)) {
        skipped.add(t);
        continue;
      }
      c.set(FACE_CLASS_INFO[cls]?.color ?? '#dc2626');
      for (let k = 0; k < 3; k++) {
        const v = idx[t * 3 + k];
        colors[v * 3] = c.r;
        colors[v * 3 + 1] = c.g;
        colors[v * 3 + 2] = c.b;
      }
    }

    const keptIdx: number[] = [];
    for (let t = 0; t < mesh.triangleFace.length; t++) {
      if (skipped.has(t)) continue;
      keptIdx.push(idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]);
    }

    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geom.setIndex(keptIdx);
    if (mesh.normals.length === mesh.positions.length) {
      geom.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(mesh.normals), 3));
    } else {
      geom.computeVertexNormals();
    }
    geom.computeBoundingBox();
    const centre = new THREE.Vector3();
    geom.boundingBox!.getCenter(centre);
    geom.translate(-centre.x, -centre.y, -centre.z);

    const solid = new THREE.Mesh(
      geom,
      new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.15, roughness: 0.65, side: THREE.DoubleSide })
    );
    scene.add(solid);
    // Wireframe overlay: face boundaries are what makes the colouring readable.
    scene.add(new THREE.LineSegments(
      new THREE.WireframeGeometry(geom),
      new THREE.LineBasicMaterial({ color: 0x0f172a, transparent: true, opacity: 0.12 })
    ));

    // Frame the part so it fills the view: fit its bounding SPHERE to the
    // narrower of the two field-of-view angles, so a long part is not cropped in
    // a wide panel. A part you have to hunt for defeats the purpose of the audit.
    geom.computeBoundingSphere();
    const radius = geom.boundingSphere?.radius || 1;
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const dist = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.05;
    camera.position.set(dist * 0.55, dist * 0.45, dist * 0.7).setLength(dist);
    camera.near = Math.max(0.01, dist - radius * 4);
    camera.far = dist + radius * 8;
    camera.updateProjectionMatrix();
    camera.lookAt(0, 0, 0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0, 0);

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    const onResize = () => {
      if (!mount.clientWidth) return;
      camera.aspect = mount.clientWidth / Math.max(1, mount.clientHeight);
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener('resize', onResize);
    // The panel is often laid out after this effect runs, so the first size can
    // be wrong; observe the mount rather than trusting the initial measurement.
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', onResize);
      controls.dispose();
      geom.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [mesh, hidden]);

  const toggle = (k: string) =>
    setHidden((h) => {
      const next = new Set(h);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });

  if (loading) {
    return (
      <div className="h-72 flex items-center justify-center gap-2 text-xs text-muted-foreground bg-accent/20 rounded-lg border border-border">
        <Loader2 size={14} className="animate-spin" /> Classifying every face…
      </div>
    );
  }
  if (!mesh) {
    return (
      <div className="h-72 flex items-center justify-center px-6 text-center text-xs text-muted-foreground bg-accent/20 rounded-lg border border-border">
        {unavailableNote ?? 'Face coverage needs the geometry service — it is not reachable, so the analysis cannot be audited here.'}
      </div>
    );
  }

  const unaccounted = mesh.unaccountedFaces ?? 0;
  const share = mesh.unaccountedAreaShare ?? 0;

  return (
    <div className="space-y-3">
      <div ref={mountRef} className="h-72 rounded-lg border border-border bg-gradient-to-b from-accent/10 to-transparent overflow-hidden" />

      {/* The headline: how much of this part the engine could not account for. */}
      <div className={cn(
        'flex gap-2 rounded-md p-2.5 border',
        unaccounted > 0 ? 'bg-amber-500/10 border-amber-500/40' : 'bg-emerald-500/10 border-emerald-500/30'
      )}>
        {unaccounted > 0
          ? <AlertTriangle size={14} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          : <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />}
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          {unaccounted > 0 ? (
            <>
              <strong className="text-foreground">
                {unaccounted} face{unaccounted === 1 ? '' : 's'} unaccounted for
              </strong>{' '}
              ({(share * 100).toFixed(1)}% of the part&rsquo;s surface). Anything red was not turned into a feature,
              so no operation, tool or minute in this quote represents it. Rotate the part and check what is red before
              you send the price.
            </>
          ) : (
            <>
              <strong className="text-foreground">Every face accounted for.</strong> Each surface of the solid was
              classified into a feature the quote prices. That is a coverage check, not a correctness one — the
              features can still be wrong, but nothing was silently dropped.
            </>
          )}
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {classes.map((row) => {
          const info = FACE_CLASS_INFO[row.key] ?? FACE_CLASS_INFO.unexplained;
          const off = hidden.has(row.key);
          const detail = Object.entries(row.detail);
          return (
            <button
              key={row.key}
              onClick={() => toggle(row.key)}
              title={`${info.blurb}${detail.length ? ` (${detail.map(([k, v]) => `${v} ${k}`).join(', ')})` : ''}`}
              className={cn(
                'flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] transition-colors',
                off ? 'opacity-40 border-border bg-transparent' : 'border-border bg-accent/40 hover:bg-accent'
              )}
            >
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: info.color }} />
              <span className="font-semibold text-foreground">{info.title}</span>
              <span className="text-muted-foreground">
                {row.faces}{row.areaShare > 0 ? ` · ${(row.areaShare * 100).toFixed(0)}%` : ''}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
        Click a swatch to hide that class and see what is underneath. Colours describe what the engine
        <em> understood</em>, not what is correct — a face can be classified confidently and still be classified wrong.
      </p>
    </div>
  );
}
