/**
 * Realistic Sample CAD Files for Instant Testing & Demo
 */

export const SAMPLE_STEP_BRACKET = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Precision Mounting Bracing Bracket STEP Model', 'Sheet Metal Component'), '2;1');
FILE_NAME('Precision_Bracing_Bracket.step', '2026-05-10T14:30:00-05:00', ('Lead Engineer'), ('QuoteForge CAD Lab'), 'SolidWorks 2026', 'SolidWorks 2026', 'Approved');
FILE_SCHEMA(('CONFIG_CONTROL_DESIGN', 'AUTOMOTIVE_DESIGN', 'AP242_MANAGED_MODEL_BASED_3D_ENGINEERING'));
ENDSEC;
DATA;
#10=SI_UNIT(*,.MILLI.,.METRE.);
#11=SI_UNIT($,.STERADIAN.);
#12=SI_UNIT($,.RADIAN.);
#15=UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(0.01),#10,'distance_accuracy_value','Precision Tolerance');
#20=CARTESIAN_POINT('Origin',(0.0,0.0,0.0));
#21=CARTESIAN_POINT('P1',(0.0,0.0,0.0));
#22=CARTESIAN_POINT('P2',(350.0,0.0,0.0));
#23=CARTESIAN_POINT('P3',(350.0,220.0,0.0));
#24=CARTESIAN_POINT('P4',(0.0,220.0,0.0));
#25=CARTESIAN_POINT('P5',(0.0,0.0,45.0));
#26=CARTESIAN_POINT('P6',(350.0,0.0,45.0));
#27=CARTESIAN_POINT('P7',(350.0,220.0,45.0));
#28=CARTESIAN_POINT('P8',(0.0,220.0,45.0));
#30=CARTESIAN_POINT('Hole1_Center',(50.0,50.0,0.0));
#31=CARTESIAN_POINT('Hole2_Center',(300.0,50.0,0.0));
#32=CARTESIAN_POINT('Hole3_Center',(50.0,170.0,0.0));
#33=CARTESIAN_POINT('Hole4_Center',(300.0,170.0,0.0));
#34=CARTESIAN_POINT('Hole5_Center',(175.0,110.0,0.0));
#35=CARTESIAN_POINT('Hole6_Center',(175.0,110.0,45.0));
#40=DIRECTION('DirX',(1.0,0.0,0.0));
#41=DIRECTION('DirY',(0.0,1.0,0.0));
#42=DIRECTION('DirZ',(0.0,0.0,1.0));
#50=AXIS2_PLACEMENT_3D('Placement1',#20,#42,#40);
#60=CYLINDRICAL_SURFACE('Hole1_Cyl',#50,4.25);
#61=CYLINDRICAL_SURFACE('Hole2_Cyl',#50,4.25);
#62=CYLINDRICAL_SURFACE('Hole3_Cyl',#50,4.25);
#63=CYLINDRICAL_SURFACE('Hole4_Cyl',#50,4.25);
#64=CYLINDRICAL_SURFACE('Hole5_Cyl',#50,6.0);
#65=CYLINDRICAL_SURFACE('Hole6_Cyl',#50,6.0);
#70=CIRCLE('Circle1',#50,4.25);
#71=CIRCLE('Circle2',#50,4.25);
#72=CIRCLE('Circle3',#50,4.25);
#73=CIRCLE('Circle4',#50,4.25);
#74=CIRCLE('Circle5',#50,6.0);
#75=CIRCLE('Circle6',#50,6.0);
#80=PLANE('BasePlane',#50);
#81=PLANE('FlangePlane1',#50);
#82=PLANE('FlangePlane2',#50);
#83=PLANE('FlangePlane3',#50);
#84=PLANE('FlangePlane4',#50);
#85=PLANE('CoverPlane',#50);
#90=ADVANCED_FACE('Face1',(#80),.T.);
#91=ADVANCED_FACE('Face2',(#81),.T.);
#92=ADVANCED_FACE('Face3',(#82),.T.);
#93=ADVANCED_FACE('Face4',(#83),.T.);
#94=ADVANCED_FACE('Face5',(#84),.T.);
#95=ADVANCED_FACE('Face6',(#85),.T.);
#100=CLOSED_SHELL('SheetMetalBody',(#90,#91,#92,#93,#94,#95));
#110=MANIFOLD_SOLID_BREP('Bracket_Solid',#100);
/* Material Specification: Mild Steel CR1018 3.0mm Thickness */
ENDSEC;
END-ISO-10303-21;`;

export const SAMPLE_STEP_ENCLOSURE = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Modular Server Enclosure Chassis STEP Model', 'Heavy Duty Steel Enclosure'), '2;1');
FILE_NAME('Server_Chassis_Enclosure.step', '2026-06-18T09:15:22-04:00', ('Design Dept'), ('QuoteForge Industries'), 'Autodesk Inventor 2026', 'Autodesk Inventor 2026', 'Released');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
ENDSEC;
DATA;
#10=SI_UNIT(*,.MILLI.,.METRE.);
#20=CARTESIAN_POINT('P1',(-220.0,-180.0,-35.0));
#21=CARTESIAN_POINT('P2',(220.0,180.0,35.0));
#30=CYLINDRICAL_SURFACE('Hole1',#10,3.2);
#31=CYLINDRICAL_SURFACE('Hole2',#10,3.2);
#32=CYLINDRICAL_SURFACE('Hole3',#10,3.2);
#33=CYLINDRICAL_SURFACE('Hole4',#10,3.2);
#34=CYLINDRICAL_SURFACE('Hole5',#10,3.2);
#35=CYLINDRICAL_SURFACE('Hole6',#10,3.2);
#36=CYLINDRICAL_SURFACE('Hole7',#10,5.0);
#37=CYLINDRICAL_SURFACE('Hole8',#10,5.0);
#40=PLANE('P1',#10);
#41=PLANE('P2',#10);
#42=PLANE('P3',#10);
#43=PLANE('P4',#10);
#44=PLANE('P5',#10);
#45=PLANE('P6',#10);
#46=PLANE('P7',#10);
#47=PLANE('P8',#10);
#50=ADVANCED_FACE('F1',(#40),.T.);
#51=ADVANCED_FACE('F2',(#41),.T.);
#52=ADVANCED_FACE('F3',(#42),.T.);
#53=ADVANCED_FACE('F4',(#43),.T.);
#54=ADVANCED_FACE('F5',(#44),.T.);
#55=ADVANCED_FACE('F6',(#45),.T.);
#56=ADVANCED_FACE('F7',(#46),.T.);
#57=ADVANCED_FACE('F8',(#47),.T.);
#60=MANIFOLD_SOLID_BREP('Enclosure_Body_1',#10);
#61=MANIFOLD_SOLID_BREP('Enclosure_Body_2',#10);
/* Material Specification: Stainless Steel 304 2.0mm Thickness */
ENDSEC;
END-ISO-10303-21;`;

export const SAMPLE_CAD_PDF_METADATA = {
  drawingNumber: "DWG-2026-8841-B",
  title: "HEAVY DUTY CONTROL CHASSIS",
  revision: "Rev C",
  author: "M. Vance / QuoteForge Engineering",
  scale: "1:2",
  units: "mm",
  material: "Mild Steel 3.0mm (CR1018)",
  finish: "Black Powder Coat (RAL 9005 Texture)",
  tolerances: "ISO 2768-m (Linear ±0.2mm, Angular ±0.5°)",
  dimensions: {
    lengthMm: 420,
    widthMm: 280,
    heightMm: 65
  },
  features: {
    holeCount: 12,
    holeDetails: [
      { diameterMm: 5.5, count: 8 },
      { diameterMm: 12.0, count: 4 }
    ],
    bendCount: 6,
    isSimpleBending: false,
    perimeterMm: 1850,
    pierceCount: 13,
    weldLengthMm: 120,
    weldCount: 4,
    weightKg: 2.85,
    surfaceAreaM2: 0.32
  },
  notes: [
    "1. ALL BENDS TO BE R1.5 MINIMUM INSIDE RADIUS.",
    "2. DEBURR AND BREAK ALL SHARP EDGES 0.5 MAX.",
    "3. POWDER COAT ALL EXTERIOR SURFACES AFTER WELDING.",
    "4. TAPPED HOLES: 4x M5x0.8 HELICOIL INSERTS."
  ]
};
