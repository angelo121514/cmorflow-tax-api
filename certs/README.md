# Certificados de confianza externos

El repositorio ya no distribuye la CA de Supabase sin condiciones de redistribución documentadas. Descarga la CA de tu proyecto desde Database Settings según la [guía oficial](https://supabase.com/docs/guides/database/connecting-to-postgres) y verifica su procedencia con el operador.

Guárdala fuera del repositorio y monta el archivo en web y worker. Configura `NODE_EXTRA_CA_CERTS=/opt/cmorflow/certs/supabase-ca.crt` antes de iniciar Node. Mantén DB_SSL=true y DB_SSL_REJECT_UNAUTHORIZED=true. No obtengas confianza únicamente de una cadena presentada por un servidor sin autenticar.

Los certificados no se incluyen en Git ni en la imagen Docker. No se requiere CA adicional para PostgreSQL local de pruebas sin TLS. Una instalación existente debe proveer su CA externamente antes de desplegar esta versión.
