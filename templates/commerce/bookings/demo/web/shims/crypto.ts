// Stand-in for node:crypto in the browser build. The code now lives in modules/demo/shims/crypto.ts, shared with the other templates' browser demos; the build
// follows this one line into it, so the file that was always the browser's `node:crypto` still is.
export * from "../../../../../../modules/demo/shims/crypto.ts";
