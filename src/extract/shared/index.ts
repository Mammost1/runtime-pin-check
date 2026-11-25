/**
 * Format parsers shared by the node, python and go extractors (docs/TASKS.md A8). They parse
 * file formats, never runtimes: the runtime modules decide which image or tool is theirs and what
 * the version text means. Every function is pure and never throws.
 */
export { parseDockerfile } from './dockerfile'
export type { DockerFrom } from './dockerfile'
export { parseGitlabCi } from './gitlab'
export type { GitlabImage } from './gitlab'
export { isRuntimeImage } from './images'
export { splitImageRef } from './imageref'
export type { ImageRef } from './imageref'
export { parseMise } from './mise'
export type { MiseTool } from './mise'
export { locateTomlKey, locateTomlTable, parseToml, parseTomlDetailed } from './toml'
export type { TomlLocation, TomlProblem } from './toml'
export { parseToolVersions } from './tool-versions'
export type { ToolEntry } from './tool-versions'
export { cleanWorkflowPath, parseWorkflow, workflowSourcePaths } from './workflow'
export type { MatrixEntry, WorkflowInput, WorkflowStep } from './workflow'
