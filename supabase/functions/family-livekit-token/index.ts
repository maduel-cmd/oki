// @ts-nocheck — Deno Edge Function: mint LiveKit token after family membership check
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { SignJWT } from 'https://esm.sh/jose@5.9.6';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

async function mintLiveKitToken(opts: {
  apiKey: string;
  apiSecret: string;
  identity: string;
  room: string;
  name?: string;
}): Promise<string> {
  const secret = new TextEncoder().encode(opts.apiSecret);
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    video: {
      roomJoin: true,
      room: opts.room,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
    name: opts.name ?? opts.identity,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(opts.apiKey)
    .setSubject(opts.identity)
    .setIssuedAt(now)
    .setNotBefore(now)
    // Short-lived: a removed member cannot reconnect after this window.
    .setExpirationTime(now + 15 * 60)
    .setJti(crypto.randomUUID())
    .sign(secret);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const familyId = body.familyId ?? body.family_id;
    if (!familyId || typeof familyId !== 'string') {
      return new Response(JSON.stringify({ error: 'familyId required' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const { data: member } = await supabase
      .from('family_members')
      .select('family_id, display_name, approved')
      .eq('family_id', familyId)
      .eq('user_id', user.id)
      .maybeSingle();

    // Pending members (waiting for a parent's approval) get no voice access.
    if (!member || member.approved === false) {
      return new Response(JSON.stringify({ error: 'forbidden' }), {
        status: 403,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const { data: family } = await supabase
      .from('families')
      .select('id')
      .eq('id', familyId)
      .maybeSingle();

    if (!family) {
      return new Response(JSON.stringify({ error: 'forbidden' }), {
        status: 403,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
    // Room name comes only from the (unguessable, immutable) family id —
    // never from a client-editable column or from the invite code.
    const room = `oki_family_${familyId}`;

    const livekitUrl = Deno.env.get('LIVEKIT_URL');
    const apiKey = Deno.env.get('LIVEKIT_API_KEY');
    const apiSecret = Deno.env.get('LIVEKIT_API_SECRET');

    if (!livekitUrl || !apiKey || !apiSecret) {
      return new Response(
        JSON.stringify({
          demo: true,
          error: 'livekit_not_configured',
          room,
          identity: user.id,
        }),
        {
          status: 200,
          headers: { ...cors, 'Content-Type': 'application/json' },
        },
      );
    }

    const token = await mintLiveKitToken({
      apiKey,
      apiSecret,
      identity: user.id,
      room,
      name:
        (member.display_name as string | undefined) ??
        (user.user_metadata?.display_name as string | undefined) ??
        user.email ??
        user.id,
    });

    return new Response(
      JSON.stringify({
        demo: false,
        url: livekitUrl,
        room,
        identity: user.id,
        token,
      }),
      { headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error('[family-livekit-token]', e);
    return new Response(JSON.stringify({ error: 'internal_error' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
