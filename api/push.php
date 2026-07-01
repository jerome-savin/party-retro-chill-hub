<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

try {
    $config = require __DIR__ . '/config.php';
    $payload = read_json_payload();
    require_push_key($config, $payload);

    $title = trim((string)($payload['title'] ?? 'Party Retro Chill Hub'));
    $body = trim((string)($payload['body'] ?? 'Nouvelle notification PRCH.'));
    $url = trim((string)($payload['url'] ?? 'chat.html'));
    $subscriptions = $payload['subscriptions'] ?? [];

    if (!is_array($subscriptions)) {
        throw new RuntimeException('Subscriptions invalides', 400);
    }
    validate_push_config($config);

    $message = json_encode([
        'title' => $title,
        'body' => $body,
        'url' => $url,
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

    $sent = 0;
    $failed = 0;
    $expired = [];
    foreach ($subscriptions as $subscription) {
        if (!is_array($subscription)) {
            $failed++;
            continue;
        }
        try {
            $status = send_web_push($config, $subscription, $message);
            if ($status === 404 || $status === 410) {
                $expired[] = (string)($subscription['endpoint'] ?? '');
            }
            if ($status >= 200 && $status < 300) {
                $sent++;
            } else {
                $failed++;
            }
        } catch (Throwable $error) {
            $failed++;
        }
    }

    echo json_encode([
        'ok' => true,
        'sent' => $sent,
        'failed' => $failed,
        'expiredEndpoints' => array_values(array_filter($expired)),
    ]);
} catch (Throwable $error) {
    $code = (int)$error->getCode();
    http_response_code($code >= 400 && $code < 600 ? $code : 500);
    echo json_encode(['ok' => false, 'error' => $error->getMessage()]);
}

function read_json_payload(): array
{
    $raw = file_get_contents('php://input') ?: '';
    $payload = json_decode($raw, true);
    if (!is_array($payload)) {
        throw new RuntimeException('Payload JSON invalide', 400);
    }
    return $payload;
}

function require_push_key(array $config, array $payload): void
{
    $headers = function_exists('getallheaders') ? getallheaders() : [];
    $headerKey = '';
    foreach ($headers as $name => $value) {
        if (strtolower((string)$name) === 'x-prch-push-key') {
            $headerKey = trim((string)$value);
            break;
        }
    }

    $expected = trim((string)($config['push_api_key'] ?? $config['mail_api_key'] ?? ''));
    $provided = $headerKey !== '' ? $headerKey : trim((string)($payload['pushKey'] ?? ''));
    if ($expected === '' || !hash_equals($expected, $provided)) {
        throw new RuntimeException('Cle push invalide', 403);
    }
}

function validate_push_config(array $config): void
{
    foreach (['vapid_public_key', 'vapid_private_key', 'vapid_subject'] as $key) {
        if (trim((string)($config[$key] ?? '')) === '') {
            throw new RuntimeException('Configuration push incomplete: ' . $key, 500);
        }
    }
}

function send_web_push(array $config, array $subscription, string $message): int
{
    $endpoint = trim((string)($subscription['endpoint'] ?? ''));
    $keys = $subscription['keys'] ?? [];
    $p256dh = trim((string)($keys['p256dh'] ?? ''));
    $auth = trim((string)($keys['auth'] ?? ''));
    if ($endpoint === '' || $p256dh === '' || $auth === '') {
        throw new RuntimeException('Subscription incomplete', 400);
    }

    $encrypted = encrypt_web_push_payload($p256dh, $auth, $message);
    $jwt = make_vapid_jwt($config, $endpoint);
    $headers = [
        'TTL: 3600',
        'Content-Type: application/octet-stream',
        'Content-Encoding: aes128gcm',
        'Authorization: vapid t=' . $jwt . ', k=' . $config['vapid_public_key'],
        'Content-Length: ' . strlen($encrypted),
    ];

    $ch = curl_init($endpoint);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_POSTFIELDS => $encrypted,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER => false,
        CURLOPT_TIMEOUT => 12,
    ]);
    curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $error = curl_error($ch);
    curl_close($ch);

    if ($status === 0 && $error !== '') {
        throw new RuntimeException('Erreur push distante: ' . $error, 502);
    }
    return $status;
}

function encrypt_web_push_payload(string $receiverPublicKey, string $authSecret, string $payload): string
{
    $clientPublic = base64url_decode($receiverPublicKey);
    $auth = base64url_decode($authSecret);
    if (strlen($clientPublic) !== 65 || $clientPublic[0] !== "\x04") {
        throw new RuntimeException('Cle publique navigateur invalide', 400);
    }

    $localKey = openssl_pkey_new([
        'private_key_type' => OPENSSL_KEYTYPE_EC,
        'curve_name' => 'prime256v1',
    ]);
    if (!$localKey) {
        throw new RuntimeException('Impossible de creer la cle ECDH', 500);
    }

    $details = openssl_pkey_get_details($localKey);
    $serverPublic = "\x04" . $details['ec']['x'] . $details['ec']['y'];
    $peerKey = openssl_pkey_get_public(ec_public_key_pem($clientPublic));
    $sharedSecret = openssl_pkey_derive($peerKey, $localKey, 32);
    if ($sharedSecret === false) {
        throw new RuntimeException('Echec derive ECDH', 500);
    }

    $authInfo = "WebPush: info\x00" . $clientPublic . $serverPublic;
    $prkKey = hash_hmac('sha256', $sharedSecret, $auth, true);
    $ikm = hkdf_expand($prkKey, $authInfo, 32);

    $salt = random_bytes(16);
    $prk = hash_hmac('sha256', $ikm, $salt, true);
    $cek = hkdf_expand($prk, "Content-Encoding: aes128gcm\x00", 16);
    $nonce = hkdf_expand($prk, "Content-Encoding: nonce\x00", 12);
    $plaintext = "\x02" . $payload;
    $tag = '';
    $ciphertext = openssl_encrypt($plaintext, 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, $tag);
    if ($ciphertext === false) {
        throw new RuntimeException('Echec chiffrement push', 500);
    }

    return $salt . pack('N', 4096) . chr(strlen($serverPublic)) . $serverPublic . $ciphertext . $tag;
}

function make_vapid_jwt(array $config, string $endpoint): string
{
    $parts = parse_url($endpoint);
    if (!isset($parts['scheme'], $parts['host'])) {
        throw new RuntimeException('Endpoint push invalide', 400);
    }
    $audience = $parts['scheme'] . '://' . $parts['host'];
    $header = ['typ' => 'JWT', 'alg' => 'ES256'];
    $claims = [
        'aud' => $audience,
        'exp' => time() + 43200,
        'sub' => (string)$config['vapid_subject'],
    ];
    $unsigned = base64url_encode(json_encode($header)) . '.' . base64url_encode(json_encode($claims));
    $privateKey = openssl_pkey_get_private(ec_private_key_pem(
        base64url_decode((string)$config['vapid_private_key']),
        base64url_decode((string)$config['vapid_public_key'])
    ));
    if (!$privateKey) {
        throw new RuntimeException('Cle VAPID privee invalide', 500);
    }
    $signature = '';
    if (!openssl_sign($unsigned, $signature, $privateKey, OPENSSL_ALGO_SHA256)) {
        throw new RuntimeException('Signature VAPID impossible', 500);
    }
    return $unsigned . '.' . base64url_encode(ecdsa_der_to_raw($signature));
}

function hkdf_expand(string $prk, string $info, int $length): string
{
    $output = '';
    $block = '';
    $counter = 1;
    while (strlen($output) < $length) {
        $block = hash_hmac('sha256', $block . $info . chr($counter), $prk, true);
        $output .= $block;
        $counter++;
    }
    return substr($output, 0, $length);
}

function ec_public_key_pem(string $publicKey): string
{
    $der = hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200') . $publicKey;
    return der_to_pem($der, 'PUBLIC KEY');
}

function ec_private_key_pem(string $privateKey, string $publicKey): string
{
    if (strlen($privateKey) !== 32 || strlen($publicKey) !== 65) {
        throw new RuntimeException('Cles VAPID invalides', 500);
    }
    $der = hex2bin('30770201010420')
        . $privateKey
        . hex2bin('a00a06082a8648ce3d030107a144034200')
        . $publicKey;
    return der_to_pem($der, 'EC PRIVATE KEY');
}

function der_to_pem(string $der, string $label): string
{
    return "-----BEGIN $label-----\n"
        . chunk_split(base64_encode($der), 64, "\n")
        . "-----END $label-----\n";
}

function ecdsa_der_to_raw(string $der): string
{
    $offset = 3;
    $rLength = ord($der[$offset]);
    $offset++;
    $r = substr($der, $offset, $rLength);
    $offset += $rLength + 1;
    $sLength = ord($der[$offset]);
    $offset++;
    $s = substr($der, $offset, $sLength);
    return str_pad(ltrim($r, "\x00"), 32, "\x00", STR_PAD_LEFT)
        . str_pad(ltrim($s, "\x00"), 32, "\x00", STR_PAD_LEFT);
}

function base64url_encode(string $value): string
{
    return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
}

function base64url_decode(string $value): string
{
    $padding = str_repeat('=', (4 - strlen($value) % 4) % 4);
    $decoded = base64_decode(strtr($value . $padding, '-_', '+/'), true);
    if ($decoded === false) {
        throw new RuntimeException('Base64url invalide', 400);
    }
    return $decoded;
}
