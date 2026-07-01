<?php
declare(strict_types=1);

$key = openssl_pkey_new([
    'private_key_type' => OPENSSL_KEYTYPE_EC,
    'curve_name' => 'prime256v1',
]);

if (!$key) {
    fwrite(STDERR, "Impossible de generer la cle VAPID.\n");
    exit(1);
}

$details = openssl_pkey_get_details($key);
$privatePem = '';
openssl_pkey_export($key, $privatePem);

$privateDer = pem_to_der($privatePem);
$privateRaw = extract_private_key($privateDer);
$publicRaw = "\x04" . $details['ec']['x'] . $details['ec']['y'];

echo "VAPID_PUBLIC_KEY=" . base64url_encode($publicRaw) . PHP_EOL;
echo "VAPID_PRIVATE_KEY=" . base64url_encode($privateRaw) . PHP_EOL;
echo "VAPID_SUBJECT=mailto:organisateurs@party-retro-chill-hub.fr" . PHP_EOL;

function pem_to_der(string $pem): string
{
    $clean = preg_replace('/-----BEGIN [^-]+-----|-----END [^-]+-----|\s+/', '', $pem);
    $der = base64_decode((string)$clean, true);
    if ($der === false) {
        throw new RuntimeException('PEM invalide');
    }
    return $der;
}

function extract_private_key(string $der): string
{
    $marker = hex2bin('0420');
    $position = strpos($der, $marker);
    if ($position === false) {
        throw new RuntimeException('Cle privee introuvable');
    }
    return substr($der, $position + 2, 32);
}

function base64url_encode(string $value): string
{
    return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
}
