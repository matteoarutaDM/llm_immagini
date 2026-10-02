import { CompanyDetailView } from "../../../_components/companies/CompanyDetailView";

export const metadata = { title: "Dettaglio azienda" };

export default async function CompanyDetailPage({ params }) {
  const { id } = await params;
  return <CompanyDetailView companyId={id} />;
}
