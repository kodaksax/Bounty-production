/**
 * Focus-first building blocks, named after the design handoff's
 * PosterBlock.dc.html (docs/design/focus-first-poster/). Despite the name,
 * they are shared by both sides: the "both sides" handoff reuses the same
 * blocks for the hunter journey, so the poster and hunter workspaces, My Jobs
 * and the job thread all import from here rather than forking look-alikes.
 *
 * Colours come from `theme.poster` (lib/themes/poster-palette.ts), which maps
 * each of the handoff's colour roles onto the app's existing colours; sizes
 * come from FOCUS in the same file.
 *
 * The featured job card, switch strip and switcher sheet already exist as
 * components/my-jobs/* (PR #1012) and are restyled there, not duplicated here.
 */
export { PosterButton, getPosterButtonLook, type PosterButtonKind, type PosterButtonProps } from './poster-button';
export { WorkspaceHeader, SidePill, SIDE_LABELS, sideColors, describeStep, type WorkspaceSide } from './workspace-header';
export { FourQuestions, MoneyLine, getMoneyLook } from './four-questions';
export {
  NoteBox,
  StageToast,
  SectionLabel,
  ConsequenceList,
  StorySoFar,
  FactsList,
  ReceiptRows,
  EmptyHero,
  FlowTitle,
  FlowNav,
  type NoteTone,
  type ConsequenceItem,
  type FactRow,
} from './blocks';
export { OtherOptions, StarRating, STAR_WORDS, describeStars, type OtherOption } from './controls';
export {
  ProofPhotos,
  PeopleStrip,
  ApplicantProfile,
  initialsOf,
  type ProofPhoto,
  type StripPerson,
  type ApplicantFact,
} from './media';
export { PosterSheet, PosterDialog, HelpSheet, type HelpOption } from './overlays';
export { WorkspaceLayout, PinnedFooter, StageFooter } from './layout';
