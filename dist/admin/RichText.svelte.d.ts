import "prosemirror-view/style/prosemirror.css";
type $$ComponentProps = {
    label: string;
    value: string;
    maxlength: number;
    disabled?: boolean;
    onchange: (value: string) => void;
};
declare const RichText: import("svelte").Component<$$ComponentProps, {}, "">;
type RichText = ReturnType<typeof RichText>;
export default RichText;
