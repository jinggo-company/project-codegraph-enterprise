export { CrossProjectEngine } from './cross-project.js';
export { LocalSqliteEngine } from './local.js';
export { getIndexFilePath } from './config.js';
export type {
  IndexEngine,
  CodeSearchResult,
  SymbolInfo,
  CallEdge,
  ImpactResult,
  RouteInfo,
  FulltextResult,
} from './engine.js';
export type {
  CrossProjectCodeResult,
  CrossProjectSymbolResult,
  CrossProjectCallEdge,
  CrossProjectFulltextResult,
  CrossProjectRouteInfo,
  CrossProjectImpactResult,
  CrossProjectFilter,
} from './cross-project.js';
