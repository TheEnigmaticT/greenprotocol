import { workspaceResponse } from '@/lib/integrations/scisure/workspace-server'
export const dynamic = 'force-dynamic'
export const revalidate = 0
export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceResponse(request, context, 'get')
}
