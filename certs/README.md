# Certificados de confianza

## supabase-root-ca.crt

Root CA `Supabase Root 2021 CA` (self-signed) usado por el pooler/directo de
Supabase para `*.pooler.supabase.com` y hosts de base de datos.

- **Origen:** extraído de la propia cadena TLS presentada por la base de datos
  (`aws-0-us-east-2.pooler.supabase.com:5432`) — fuente auténtica por
  construcción, no de terceros.
- **Fingerprint SHA-256:** `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`
- **Uso:** `NODE_EXTRA_CA_CERTS=/opt/render/project/src/certs/supabase-root-ca.crt`
  en producción, para que Node confíe el CA privado de Supabase sin desactivar
  la verificación TLS (`DB_SSL_REJECT_UNAUTHORIZED` se mantiene en `true`).
