# Code signing the Windows installer

Unsigned, Windows shows "Windows protected your PC" and "Unknown publisher" when the installer runs.
Signing puts a verified publisher name on it. SmartScreen can still warn for a while after you start
signing: it learns to trust a publisher as people download and run their files.

A code signing certificate is only issued after the publisher's identity is checked, so it cannot be
created automatically. The build is ready for either of the two practical options below: add the
values as described and the next build signs itself, then checks the signature and fails if it is invalid.
Without them it builds unsigned, as before.

## Option 1: SignPath Foundation (free, open source only)

Free certificates for open-source projects. Requires a **public** repository under an OSI-approved
licence (VLcut is GPL-3.0, which qualifies), verifiable builds from that repository, multi-factor
login for everyone involved, and the credit line "Free code signing provided by SignPath.io, certificate
by SignPath Foundation". The Foundation is the listed publisher. Apply at https://signpath.org. Their
signing runs as a step after the build; once you are accepted, ask and it can be added to the workflow.

## Option 2: Azure Artifact Signing (formerly Trusted Signing), about US$10 a month

Microsoft's signing service, which works directly from GitHub Actions. As of mid-2026, individual
developers can sign up only in the USA and Canada; organisations in the USA, Canada, the EU and the UK.
Check the current rules on Microsoft's site before paying.

After creating the signing account, an identity validation and a certificate profile in Azure, and an
app registration with the "Artifact Signing Certificate Profile Signer" role:

1. In the GitHub repository go to **Settings → Secrets and variables → Actions**.
2. Under **Secrets**, add `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET` from the app registration.
3. Under **Variables**, add `AZURE_SIGNING_ENDPOINT` (for example `https://weu.codesigning.azure.net`),
   `AZURE_SIGNING_ACCOUNT` (the signing account name) and `AZURE_SIGNING_PROFILE` (the certificate profile name).

## Option 3: a certificate file you already have

Only possible with a certificate that can be exported as a `.pfx` file. Certificates issued since June
2023 are kept on hardware tokens and cannot be exported, so this mostly applies to older ones.
Add the secrets `WINDOWS_CERT_PFX_BASE64` (the `.pfx` file, base64-encoded) and `WINDOWS_CERT_PASSWORD`.

## Checking the setup without a certificate

**Actions → Build Windows installer → Run workflow** with "test signing" ticked signs the build with a
throwaway self-signed certificate and checks the signature is there. That installer is not uploaded:
a self-signed signature is not trusted by Windows and does not help users.
