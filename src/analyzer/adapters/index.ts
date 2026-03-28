import { expressSemanticAdapter } from "./express";
import { nestSemanticAdapter } from "./nest";
import { reactSemanticAdapter } from "./react";
import { vueSemanticAdapter } from "./vue";

export {
  resolveFrameworkCallbackHook,
  resolveFrameworkDecoratedMethodOwner,
  resolveFrameworkStateHook,
} from "./types";
export type {
  FrameworkCallbackHookResolution,
  FrameworkDecoratedMethodOwnerResolution,
  FrameworkSemanticAdapter,
  FrameworkStateHookResolution,
} from "./types";

export const defaultFrameworkSemanticAdapters = [
  reactSemanticAdapter,
  vueSemanticAdapter,
  expressSemanticAdapter,
  nestSemanticAdapter,
] as const;
