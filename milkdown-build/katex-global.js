// Maps `import katex from 'katex'` to window.katex loaded via <script> tag.
// This keeps KaTeX out of the Milkdown bundle (Opsi B: separate vendor file).
export default globalThis.katex;
