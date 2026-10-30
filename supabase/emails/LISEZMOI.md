# E-mails Razzia pour Supabase

Dans Supabase : Authentication, puis Emails (ou Email Templates). Pour chaque modèle, coller le HTML et changer le sujet.

| Modèle Supabase | Fichier | Sujet |
| --- | --- | --- |
| Confirm signup | confirmation.html | Confirme ton compte Razzia |
| Reset password | reset-password.html | Ton nouveau mot de passe Razzia |
| Magic link | magic-link.html | Ton lien de connexion Razzia |
| Change email address | change-email.html | Confirme ta nouvelle adresse |

Le logo et le marbre viennent du site (simbet-mu.vercel.app/email/). `{{ .ConfirmationURL }}` est remplacé par Supabase.
