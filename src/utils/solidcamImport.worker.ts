import { previewSolidcamLibrary } from './solidcamImport';
self.onmessage = async (event: MessageEvent<{ bytes: ArrayBuffer; filename: string }>) => {
  try {
    self.postMessage({ preview: await previewSolidcamLibrary(new Uint8Array(event.data.bytes), event.data.filename) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Could not read the tool library.' });
  }
};
