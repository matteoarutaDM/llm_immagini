import { UserDetailView } from "../../../_components/users/UserDetailView";

export const metadata = { title: "Dettaglio utente" };

export default async function UserDetailPage({ params }) {
  const { id } = await params;
  return <UserDetailView userId={id} />;
}
