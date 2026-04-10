export type NodeType = "file" | "directory";

export type SkipReason =
	| "binarySkipped"
	| "symlinkSkipped"
	| "circularSymlink"
	| "permissionDenied"
	| "fsError";

export interface SkipReasonCounts {
	binarySkipped: number;
	symlinkSkipped: number;
	circularSymlink: number;
	permissionDenied: number;
	fsError: number;
}

export interface TreeNode {
	name: string;
	type: NodeType;
	children?: TreeNode[];
	size?: number;
	extension?: string;
	isBinary?: boolean;
	isSymlink?: boolean;
}

export interface TreeStats {
	files: number;
	directories: number;
	maxDepthReached: number;
	ignored: number;
	skipped: number;
	skippedByReason: SkipReasonCounts;
	totalSizeBytes: number;
	extensionCounts: Record<string, number>;
}

export interface EffectiveSettingsSnapshot {
	maxDepth: number;
	followSymlinks: boolean;
	binaryHandling: BinaryHandlingMode;
	iconMode: "none" | "bundled" | "local" | "remote";
	exportFormats: string[];
}

export interface GenerationMetadata {
	scanDurationMs: number;
	effectiveSettings: EffectiveSettingsSnapshot;
}

export type BinaryHandlingMode = "off" | "mark" | "skip";

export interface TreeBuildOptions {
	maxDepth: number;
	showFileSize: boolean;
	followSymlinks: boolean;
	binaryHandling: BinaryHandlingMode;
	shouldIgnore: (relativePath: string, isDirectory: boolean) => boolean;
}

export interface TreeBuildResult {
	nodes: TreeNode[];
	stats: TreeStats;
	warnings: string[];
}

export interface RenderOptions {
	showFileSize: boolean;
	asciiOnly: boolean;
	binaryHandling: BinaryHandlingMode;
	iconSource: "bundled" | "local" | "remote";
	iconBasePath?: string;
	bundledIconData?: Record<string, string>;
}
