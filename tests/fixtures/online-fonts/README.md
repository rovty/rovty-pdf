These font files are regression fixtures only; production fonts are fetched through the public provider APIs.

- Aileron Regular 1.102: https://api.fontsource.org/v1/registry/families/aileron — CC0, original license in Aileron-CC0.txt.
- Poppins Regular: Fontshare open-source catalog entry 0f6986a3-213c-4247-a2c7-728991f22f36, style 24aafeab-778c-4a75-8e10-f6ff9e5a5772. Copyright 2014–2022 Indian Type Foundry. SIL Open Font License 1.1 (Poppins-OFL.txt; license notice also embedded in the font). The provider file uses “false” as its internal name; the fixture PDF names it Poppins-Regular, matching an ordinary source document.

The `-subset` files contain only space, A and B, generated with fontTools using the procedure in ../latin-modern/README.md. The original outlines are unchanged. `providers.json` captures only the provider records needed by tests.
