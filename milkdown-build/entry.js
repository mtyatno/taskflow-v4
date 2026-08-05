export {
  Editor,
  rootCtx,
  defaultValueCtx,
  editorViewCtx,
  serializerCtx,
  parserCtx,
  commandsCtx,
  EditorStatus,
} from '@milkdown/core';

export {
  gfm,
  toggleStrikethroughCommand,
  insertTableCommand,
  // ── Table editing commands ──────────────────────────────────
  goToPrevTableCellCommand,
  goToNextTableCellCommand,
  exitTable,
  moveRowCommand,
  moveColCommand,
  selectRowCommand,
  selectColCommand,
  selectTableCommand,
  deleteSelectedCellsCommand,
  addColBeforeCommand,
  addColAfterCommand,
  addRowBeforeCommand,
  addRowAfterCommand,
  setAlignCommand,
} from '@milkdown/preset-gfm';

export {
  commonmark,
  toggleStrongCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  wrapInHeadingCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  wrapInBlockquoteCommand,
  insertHrCommand,
  // ── Additional commands ────────────────────────────────────
  toggleLinkCommand,
  updateLinkCommand,
  insertImageCommand,
  updateImageCommand,
  createCodeBlockCommand,
  insertHardbreakCommand,
  turnIntoTextCommand,
  liftListItemCommand,
  sinkListItemCommand,
} from '@milkdown/preset-commonmark';

export { listener, listenerCtx } from '@milkdown/plugin-listener';
export { history } from '@milkdown/plugin-history';
export { callCommand, $node, $remark, $inputRule, $prose, replaceAll } from '@milkdown/utils';
export { math } from '@milkdown/plugin-math';
export { indent } from '@milkdown/plugin-indent';
export { emoji } from '@milkdown/plugin-emoji';
export { slashFactory, SlashProvider } from '@milkdown/plugin-slash';
export { tooltipFactory, TooltipProvider } from '@milkdown/plugin-tooltip';
export { trailing } from '@milkdown/plugin-trailing';

// ProseMirror re-exports needed for custom wikilink plugin
export { InputRule } from '@milkdown/prose/inputrules';
export { TextSelection } from '@milkdown/prose/state';
// ProseMirror Plugin needed for custom markdown-paste plugin
export { Plugin, PluginKey } from '@milkdown/prose/state';
