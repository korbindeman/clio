interface ListItem {
    key: string;
    src: string;
    srcset?: string;
    ratio?: number;
    label?: string;
    placeholder?: string;
}
interface Props {
    items: ListItem[];
    layout?: "strip" | "justified";
    disabled?: boolean;
    selected?: string | null;
    addLabel?: string;
    firstLabel?: string;
    onreorder: (from: number, to: number) => void;
    onremove: (index: number) => void;
    onadd: (files: File[]) => void;
    onselect?: (key: string, index: number) => void;
}
declare const ImageList: import("svelte").Component<Props, {}, "">;
type ImageList = ReturnType<typeof ImageList>;
export default ImageList;
