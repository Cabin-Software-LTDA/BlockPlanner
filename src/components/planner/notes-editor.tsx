"use client";
import { useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";

export function NotesEditor({
  initial,
  markdown,
  onChange,
}: {
  initial: string;
  markdown: boolean;
  onChange: (value: string) => void;
}) {
  const [source, setSource] = useState(false);
  const [value, setValue] = useState(initial);
  const [link, setLink] = useState("");
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        underline: false,
        link: { openOnClick: true, defaultProtocol: "https" },
      }),
      Markdown,
    ],
    immediatelyRender: false,
    content: markdown
      ? initial
      : {
          type: "doc",
          content: initial
            .split("\n")
            .map((text) => ({
              type: "paragraph",
              ...(text ? { content: [{ type: "text", text }] } : {}),
            })),
        },
    ...(markdown ? { contentType: "markdown" as const } : {}),
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": "Task notes",
        "aria-multiline": "true",
        class: "notes-prose",
      },
    },
    onUpdate: ({ editor }) => {
      const next = editor.getMarkdown();
      setValue(next);
      onChange(next);
    },
  });
  return (
    <section className="notes-editor" aria-label="Notes editor">
      <div className="section-heading">
        <strong>Notes</strong>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            if (!source && editor) setValue(editor.getMarkdown());
            if (source && editor)
              editor.commands.setContent(value, { contentType: "markdown" });
            setSource(!source);
          }}
        >
          {source ? "Rich text" : "Markdown"}
        </button>
      </div>
      {!source && (
        <div className="notes-toolbar" role="group" aria-label="Format notes">
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleBold().run()}
            aria-label="Bold"
          >
            <b>B</b>
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleItalic().run()}
            aria-label="Italic"
          >
            <i>I</i>
          </button>
          <button
            type="button"
            onClick={() =>
              editor?.chain().focus().toggleHeading({ level: 2 }).run()
            }
          >
            Heading
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          >
            Bullets
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          >
            Numbered
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          >
            Quote
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
          >
            Code
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().undo().run()}
          >
            Undo
          </button>
        </div>
      )}
      {source ? (
        <textarea
          aria-label="Markdown notes"
          rows={8}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            onChange(e.target.value);
          }}
        />
      ) : (
        <EditorContent editor={editor} />
      )}
      {!source && (
        <div className="notes-link">
          <input
            aria-label="Note link URL"
            type="url"
            placeholder="https://…"
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
          <button
            type="button"
            className="secondary"
            disabled={!/^https?:\/\//i.test(link)}
            onClick={() => {
              if (!editor || !/^https?:\/\//i.test(link)) return;
              if (editor.state.selection.empty)
                editor
                  .chain()
                  .focus()
                  .insertContent({
                    type: "text",
                    text: link,
                    marks: [{ type: "link", attrs: { href: link } }],
                  })
                  .run();
              else editor.chain().focus().setLink({ href: link }).run();
              setLink("");
            }}
          >
            Add link
          </button>
        </div>
      )}
      <p className="muted">
        Meeting notes, decisions and links · stored locally as Markdown. Save
        task to keep changes.
      </p>
    </section>
  );
}
