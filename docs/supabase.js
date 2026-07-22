(() => {
  const SUPABASE_URL = 'https://rpdejukuajqkvxdcgkny.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_krd3He1BKOfQPU3CkoKJyg_Lhj_kFmL';

  if (!window.supabase?.createClient) {
    console.error('Supabase library did not load.');
    return;
  }

  const client = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    {
      db: {
        retry: false
      }
    }
  );

  window.supabaseClient = client;

  client.auth.getSession()
    .then(({ data, error }) => {
      if (error) {
        console.error('Supabase connection failed:', error);
        return;
      }

      console.info('Supabase connected.', {
        projectUrl: SUPABASE_URL,
        signedIn: Boolean(data.session)
      });
    })
    .catch((error) => {
      console.error('Supabase connection test failed:', error);
    });
})();
