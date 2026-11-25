/**
 * runtime-pin-check: find Node, Python and Go version pins that disagree across a repo's files,
 * reported with file and line, per project root.
 */
export { describeConstraint, dockerTagConstraint, isFloatingAlias, parseConstraint, toRange } from './constraint'
export { compareSources, groupByScope, isSharedFile, scopesOf } from './compare'
export { findProjectRoots, IGNORED_DIRS, projectRootsOf, ROOT_MARKERS, walkFiles } from './scan'
export type {
  AliasResolver,
  CompareOptions,
  Constraint,
  ConstraintKind,
  Finding,
  FindingCode,
  Runtime,
  Scope,
  Severity,
  Source,
  SourceRef,
} from './types'
