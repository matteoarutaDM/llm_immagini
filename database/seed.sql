-- =============================================================================
-- Account operatori iniziali del backoffice. Eseguire DOPO schema.sql.
-- È l'unico dato non proveniente dal sito: senza almeno un operatore non si
-- può entrare in /admin. CAMBIARE LE PASSWORD prima della produzione:
--   UPDATE ops.operators SET password_hash = crypt('nuova-password', gen_salt('bf', 12))
--    WHERE email = 'admin@backoffice.local';
-- =============================================================================

INSERT INTO ops.operators (email, name, role, password_hash, requires_otp) VALUES
  ('admin@backoffice.local',   'Admin Operativo',  'admin',   crypt('Admin!2026',   gen_salt('bf', 12)), true),
  ('support@backoffice.local', 'Supporto Tecnico', 'support', crypt('Support!2026', gen_salt('bf', 12)), false)
ON CONFLICT (email) DO NOTHING;
