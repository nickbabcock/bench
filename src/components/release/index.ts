/**
 * The release template every benchmark page is built from:
 *
 *   <SiteShell>
 *     <HighlightScope>
 *       <ReleaseHeader title meta switches notice measure />
 *       <ReleaseBody sections>
 *         <Section id="points"><MainPoints points /></Section>
 *         <Section id="speed"><Figure n title subtitle notes><DotRange …/></Figure></Section>
 *         <Section id="table"><DataTable …/></Section>
 *         <MeasurementNotes edition rawHref />
 *         <MeasureSection run … />
 *         <ResultsTarget>{announcement}</ResultsTarget>
 *       </ReleaseBody>
 *     </HighlightScope>
 *   </SiteShell>
 *
 * See /dev-kit for every piece with fixture data.
 */
export { ReleaseHeader, ReleaseNotice, Switch, DatasetSwitch, BrowserSwitch, wrapClass } from "./ReleaseHeader";
export type { MetaItem, ReleaseHeaderProps, SwitchOption, SwitchProps, Dataset, DatasetSwitchProps } from "./ReleaseHeader";
export { ReleaseBody, Section, Prose } from "./ReleaseBody";
export type { ReleaseBodyProps, SectionProps, SectionSpec } from "./ReleaseBody";
export { MainPoints } from "./MainPoints";
export { Cited } from "./Cited";
export type { CitedProps } from "./Cited";
export type { MainPoint, MainPointsProps } from "./MainPoints";
export { Figure, figureId } from "./Figure";
export type { FigureProps } from "./Figure";
export { DataTable } from "./DataTable";
export type { Column, DataTableProps } from "./DataTable";
export { MeasureSection, MeasureRow, ChoiceChips, ResultsTarget, RESULTS_ID } from "./MeasureSection";
export type { MeasureSectionProps, RunOutcome, Choice } from "./MeasureSection";
export { MeasurementNotes, editionProvenance, sourceLine, editionDate, runDate } from "./MeasurementNotes";
export type { MeasurementNotesProps, NoteItem } from "./MeasurementNotes";
export { RawDataLink } from "./RawDataLink";
export { captureNote, conditionsNote, monthOf, ms, OtherRunning, overallOnly, THIS_MACHINE, useDataset, useSupport } from "./page";
export { keepTogether, nbNode } from "./nb";
export type { RawDataLinkProps } from "./RawDataLink";
export { HighlightScope, useHighlight, type Highlight } from "@/components/highlight";
