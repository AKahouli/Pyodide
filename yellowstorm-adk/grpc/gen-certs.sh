#!/usr/bin/env bash
#
# Generate TLS material for the gRPC server: a private CA + a server certificate
# signed by it, with a SAN matching the host the client connects to.
#
# Usage:
#   ./grpc/gen-certs.sh [HOST] [OUT_DIR]
#
#   HOST     hostname the client uses in CONVERSATION_GRPC_URL, WITHOUT the port.
#            Must match the cert SAN or TLS verification fails. Default: localhost
#   OUT_DIR  where to write the files. Default: grpc/certs
#
# Examples:
#   ./grpc/gen-certs.sh                       # local dev, SAN=localhost
#   ./grpc/gen-certs.sh ai-service.internal   # production hostname
#
# Outputs (in OUT_DIR):
#   ca.crt      CA public cert      -> GIVE TO THE CLIENT (public)
#   ca.key      CA private key      -> SECRET, keep on server side only
#   server.crt  server certificate  -> server's GRPC_TLS_CERT_PATH
#   server.key  server private key  -> SECRET, server's GRPC_TLS_KEY_PATH
#
set -euo pipefail

HOST="${1:-localhost}"
OUT="${2:-grpc/certs}"

command -v openssl >/dev/null || { echo "openssl is required" >&2; exit 1; }

mkdir -p "$OUT"
cd "$OUT"

echo "Generating CA + server cert for host '${HOST}' in ${OUT}/ ..."

# 1) Private CA (self-signed root) — 10 years
openssl genrsa -out ca.key 4096
openssl req -x509 -new -nodes -key ca.key -sha256 -days 3650 \
  -subj "/CN=YellowStorm-Internal-CA" -out ca.crt

# 2) Server private key + CSR
openssl genrsa -out server.key 2048
openssl req -new -key server.key -subj "/CN=${HOST}" -out server.csr

# 3) Sign the server cert with the CA, embedding the SAN
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -days 825 -sha256 -out server.crt \
  -extfile <(printf "subjectAltName=DNS:%s" "$HOST")

# Tidy up + lock down private keys
rm -f server.csr ca.srl
chmod 600 ca.key server.key

echo "Done. Files in ${OUT}/:"
ls -1
echo
echo "Server (this service): set GRPC_TLS_CERT_PATH=server.crt, GRPC_TLS_KEY_PATH=server.key"
echo "Client (backend):      give them ca.crt ONLY. Never share *.key."
