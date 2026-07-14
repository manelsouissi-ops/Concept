import path from "path";

export default {
  outputFileTracingRoot: path.resolve(__dirname),
  distDir: process.env.NEXT_DIST_DIR || ".next"
};
