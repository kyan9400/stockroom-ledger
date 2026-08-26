import type { Dashboard, MovementCommand } from '../types'

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `Request failed (${response.status})`
    try {
      const body = (await response.json()) as { detail?: string }
      if (body.detail) message = body.detail
    } catch {
      // Preserve the status-based fallback when the response is not JSON.
    }
    throw new Error(message)
  }
  return response.json() as Promise<T>
}

export async function fetchDashboard(signal?: AbortSignal): Promise<Dashboard> {
  return readJson<Dashboard>(await fetch('/api/dashboard', { signal }))
}

export async function submitMovement(command: MovementCommand): Promise<void> {
  const idempotencyKey = crypto.randomUUID()
  await readJson(
    await fetch('/api/movements', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(command),
    }),
  )
}

