// @ts-nocheck — Deno Edge Function: disconnect a removed member from the family voice room.
//
// Removing a row from family_members stops NEW tokens, but a participant that is
// already connected stays in the LiveKit room. A parent's client calls this right
// after removing a member; it verifies the caller is an approved admin of the family
// and that the target is no longer an approved member, then asks LiveKit to drop them.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { SignJWT } from 'https://esm.sh/jose@5.9.6';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));
    const familyId = body.familyId;
    const targetId = body.userId;
    if (
      typeof familyId !== 'string' ||
      typeof targetId !== 'string' ||
      !UUID.test(familyId) ||
      !UUID.test(targetId)
    ) {
      return json({ error: 'bad_request' }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return json({ error: 'unauthorized' }, 401);

    // RLS: an approved member sees the family's rows; we still check the role.
    const { data: me } = await supabase
      .from('family_members')
      .select('role, approved')
      .eq('family_id', familyId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!me || me.role !== 'admin' || me.approved === false) {
      return json({ error: 'forbidden' }, 403);
    }

    // Only kick someone who is no longer an approved member of this family.
    const { data: target } = await supabase
      .from('family_members')
      .select('approved')
      .eq('family_id', familyId)
      .eq('user_id', targetId)
      .maybeSingle();
    if (target && target.approved !== false) {
      return json({ error: 'still_member' }, 409);
    }

    const livekitUrl = Deno.env.get('LIVEKIT_URL');
    const apiKey = Deno.env.get('LIVEKIT_API_KEY');
    const apiSecret = Deno.env.get('LIVEKIT_API_SECRET');
    if (!livekitUrl || !apiKey || !apiSecret) {
      return json({ kicked: false, reason: 'livekit_not_configured' });
    }

    const room = `oki_family_${familyId}`;
    const now = Math.floor(Date.now() / 1000);
    const adminToken = await new SignJWT({ video: { roomAdmin: true, room } })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(apiKey)
      .setSubject('oki-server')
      .setIssuedAt(now)
      .setNotBefore(now)
      .setExpirationTime(now + 60)
      .sign(new TextEncoder().encode(apiSecret));

    const host = livekitUrl.replace(/^ws/i, 'http').replace(/\/$/, '');
    const res = await fetch(
      `${host}/twirp/livekit.RoomService/RemoveParticipant`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ room, identity: targetId }),
      },
    );
    // 404 = not in the room right now — that is fine.
    if (!res.ok && res.status !== 404) {
      console.error('[family-kick-member] livekit', res.status, await res.text());
      return json({ kicked: false, reason: 'livekit_error' }, 502);
    }
    return json({ kicked: res.ok });
  } catch (e) {
    console.error('[family-kick-member]', e);
    return json({ error: 'internal_error' }, 500);
  }
});
