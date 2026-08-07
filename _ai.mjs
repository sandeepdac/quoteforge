import { fromAiData } from './src/utils/cadAnalyzer.ts';
const t = fromAiData('bushing.pdf','PDF',{partName:'B', materialName:'Brass CZ121', partClass:'turned',
  turned:{ odMm:25, lengthMm:40, boreDiaMm:12, boreDepthMm:40, grooveCount:1, threadCount:0, faceCount:2 }});
console.log('ok', t.isTurned, t.barDiameterMm);
