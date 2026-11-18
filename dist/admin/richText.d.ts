import { Schema, type Node } from "prosemirror-model";
import { Plugin } from "prosemirror-state";
export declare const schema: Schema<"text" | "doc" | "paragraph" | "ordered_list" | "bullet_list" | "list_item" | "hard_break", "link" | "em" | "strong">;
export declare function linkHref(input: string | null): string | null;
export declare const parseMarkdown: (source: string) => Node;
export declare const serializeMarkdown: (doc: Node) => string;
export declare const joinLists: Plugin<any>;
