import { AnalysisDetailView } from "../../../_components/analyses/AnalysisDetailView";

export const metadata = { title: "Dettaglio analisi" };

export default async function AnalysisDetailPage({ params }) {
  const { id } = await params;
  return <AnalysisDetailView analysisId={id} />;
}
