import { WorkspaceLoader } from "@/components/workspace/WorkspaceLoader";

export default async function ModelResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WorkspaceLoader id={id} mode="results" />;
}
