import { analyzeKw } from "./kw-analysis";
self.onmessage = (e) => {
  try {
    self.postMessage({ report: analyzeKw(e.data) });
  } catch (error) {
    self.postMessage({ error: (error as Error).message });
  }
};
