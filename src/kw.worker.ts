import { analyzeKw } from "./kw-analysis";
import { analyzePlacement } from "./placement-analysis";
self.onmessage = (e) => {
  try {
    self.postMessage({
      report:
        e.data.kind === "placement"
          ? analyzePlacement(e.data)
          : analyzeKw(e.data),
    });
  } catch (error) {
    self.postMessage({ error: (error as Error).message });
  }
};
