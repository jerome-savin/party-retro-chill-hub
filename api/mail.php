<?php
declare(strict_types=1);

const MAX_RECIPIENTS = 20;
const MAX_SUBJECT_LENGTH = 160;
const MAX_BODY_LENGTH = 20000;

json_response_headers();

try {
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        throw new RuntimeException('Methode non autorisee', 405);
    }

    $config = load_config();
    $payload = read_json_body();
    require_mail_key($config, $payload);

    $recipients = normalize_recipients($payload['to'] ?? null);
    $subject = normalize_text($payload['subject'] ?? '', MAX_SUBJECT_LENGTH);
    $text = normalize_text($payload['text'] ?? '', MAX_BODY_LENGTH);
    $html = normalize_optional_text($payload['html'] ?? null, MAX_BODY_LENGTH);
    $replyTo = normalize_optional_email($payload['replyTo'] ?? null);

    if (!$recipients) {
        throw new RuntimeException('Destinataire requis', 400);
    }
    if ($subject === '') {
        throw new RuntimeException('Sujet requis', 400);
    }
    if ($text === '' && $html === null) {
        throw new RuntimeException('Contenu requis', 400);
    }

    send_smtp_mail($config, $recipients, $subject, $text, $html, $replyTo);

    json_response([
        'ok' => true,
        'sent' => count($recipients),
    ]);
} catch (Throwable $error) {
    $status = $error->getCode();
    if ($status < 400 || $status > 599) {
        $status = 500;
    }
    json_response([
        'ok' => false,
        'error' => $error->getMessage(),
    ], $status);
}

function load_config(): array
{
    $path = __DIR__ . '/config.php';
    if (!is_file($path)) {
        throw new RuntimeException('Configuration PHP manquante', 500);
    }

    $config = require $path;
    if (!is_array($config)) {
        throw new RuntimeException('Configuration PHP invalide', 500);
    }

    foreach (['mail_api_key', 'smtp_host', 'smtp_username', 'smtp_password', 'mail_from'] as $key) {
        if (trim((string)($config[$key] ?? '')) === '') {
            throw new RuntimeException('Configuration mail incomplete: ' . $key, 500);
        }
    }

    return $config;
}

function read_json_body(): array
{
    $raw = file_get_contents('php://input') ?: '';
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        throw new RuntimeException('JSON invalide', 400);
    }
    return $decoded;
}

function require_mail_key(array $config, array $payload): void
{
    $headers = function_exists('getallheaders') ? getallheaders() : [];
    $headerKey = '';
    foreach ($headers as $name => $value) {
        if (strtolower((string)$name) === 'x-prch-mail-key') {
            $headerKey = trim((string)$value);
            break;
        }
    }

    $provided = $headerKey !== '' ? $headerKey : trim((string)($payload['mailKey'] ?? ''));
    $expected = trim((string)$config['mail_api_key']);
    if ($provided === '' || !hash_equals($expected, $provided)) {
        throw new RuntimeException('Cle mail invalide', 403);
    }
}

function normalize_recipients($value): array
{
    $items = is_array($value) ? $value : [$value];
    $recipients = [];
    foreach ($items as $item) {
        $email = normalize_optional_email($item);
        if ($email !== null) {
            $recipients[$email] = $email;
        }
    }
    $recipients = array_values($recipients);
    if (count($recipients) > MAX_RECIPIENTS) {
        throw new RuntimeException('Trop de destinataires', 400);
    }
    return $recipients;
}

function normalize_text($value, int $maxLength): string
{
    $text = trim((string)$value);
    if (strlen($text) > $maxLength) {
        throw new RuntimeException('Texte trop long', 400);
    }
    return $text;
}

function normalize_optional_text($value, int $maxLength): ?string
{
    if ($value === null || $value === '') {
        return null;
    }
    return normalize_text($value, $maxLength);
}

function normalize_optional_email($value): ?string
{
    $email = trim((string)$value);
    if ($email === '') {
        return null;
    }
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        throw new RuntimeException('Adresse email invalide', 400);
    }
    return $email;
}

function send_smtp_mail(array $config, array $recipients, string $subject, string $text, ?string $html, ?string $replyTo): void
{
    $host = trim((string)$config['smtp_host']);
    $port = (int)($config['smtp_port'] ?? 465);
    $secure = strtolower(trim((string)($config['smtp_secure'] ?? 'ssl')));
    $username = trim((string)$config['smtp_username']);
    $password = (string)$config['smtp_password'];
    $from = trim((string)$config['mail_from']);
    $fromName = trim((string)($config['mail_from_name'] ?? ''));

    $transport = $secure === 'ssl' ? 'ssl://' : '';
    $socket = @stream_socket_client($transport . $host . ':' . $port, $errno, $errstr, 20, STREAM_CLIENT_CONNECT);
    if (!$socket) {
        throw new RuntimeException('Connexion SMTP impossible: ' . $errstr, 502);
    }
    stream_set_timeout($socket, 20);

    try {
        smtp_expect($socket, [220]);
        smtp_command($socket, 'EHLO party-retro-chill-hub.fr', [250]);
        if ($secure === 'tls') {
            smtp_command($socket, 'STARTTLS', [220]);
            if (!stream_socket_enable_crypto($socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
                throw new RuntimeException('Activation TLS impossible', 502);
            }
            smtp_command($socket, 'EHLO party-retro-chill-hub.fr', [250]);
        }
        smtp_command($socket, 'AUTH LOGIN', [334]);
        smtp_command($socket, base64_encode($username), [334]);
        smtp_command($socket, base64_encode($password), [235]);
        smtp_command($socket, 'MAIL FROM:<' . $from . '>', [250]);
        foreach ($recipients as $recipient) {
            smtp_command($socket, 'RCPT TO:<' . $recipient . '>', [250, 251]);
        }
        smtp_command($socket, 'DATA', [354]);
        smtp_write_data($socket, build_message($from, $fromName, $recipients, $subject, $text, $html, $replyTo));
        smtp_expect($socket, [250]);
        smtp_command($socket, 'QUIT', [221]);
    } finally {
        fclose($socket);
    }
}

function build_message(string $from, string $fromName, array $recipients, string $subject, string $text, ?string $html, ?string $replyTo): string
{
    $headers = [
        'From: ' . format_mailbox($from, $fromName),
        'To: ' . implode(', ', array_map(fn($email) => format_mailbox($email, ''), $recipients)),
        'Subject: ' . mail_header_encode($subject),
        'Date: ' . date(DATE_RFC2822),
        'Message-ID: <' . bin2hex(random_bytes(16)) . '@party-retro-chill-hub.fr>',
        'MIME-Version: 1.0',
    ];
    if ($replyTo !== null) {
        $headers[] = 'Reply-To: ' . format_mailbox($replyTo, '');
    }

    if ($html === null) {
        $headers[] = 'Content-Type: text/plain; charset=UTF-8';
        $headers[] = 'Content-Transfer-Encoding: 8bit';
        return implode("\r\n", $headers) . "\r\n\r\n" . normalize_newlines($text);
    }

    $boundary = 'prch_' . bin2hex(random_bytes(12));
    $headers[] = 'Content-Type: multipart/alternative; boundary="' . $boundary . '"';

    return implode("\r\n", $headers)
        . "\r\n\r\n--" . $boundary
        . "\r\nContent-Type: text/plain; charset=UTF-8"
        . "\r\nContent-Transfer-Encoding: 8bit\r\n\r\n"
        . normalize_newlines($text !== '' ? $text : strip_tags($html))
        . "\r\n\r\n--" . $boundary
        . "\r\nContent-Type: text/html; charset=UTF-8"
        . "\r\nContent-Transfer-Encoding: 8bit\r\n\r\n"
        . normalize_newlines($html)
        . "\r\n\r\n--" . $boundary . '--';
}

function smtp_command($socket, string $command, array $expectedCodes): string
{
    smtp_write($socket, $command);
    return smtp_expect($socket, $expectedCodes);
}

function smtp_write($socket, string $line): void
{
    fwrite($socket, $line . "\r\n");
}

function smtp_write_data($socket, string $message): void
{
    $message = normalize_newlines($message);
    $message = preg_replace('/^\./m', '..', $message);
    fwrite($socket, $message . "\r\n.\r\n");
}

function smtp_expect($socket, array $expectedCodes): string
{
    $response = '';
    while (($line = fgets($socket, 515)) !== false) {
        $response .= $line;
        if (strlen($line) >= 4 && $line[3] === ' ') {
            break;
        }
    }
    $code = (int)substr($response, 0, 3);
    if (!in_array($code, $expectedCodes, true)) {
        throw new RuntimeException('Erreur SMTP: ' . summarize($response), 502);
    }
    return $response;
}

function format_mailbox(string $email, string $name): string
{
    if ($name === '') {
        return '<' . $email . '>';
    }
    return mail_header_encode($name) . ' <' . $email . '>';
}

function mail_header_encode(string $value): string
{
    if (preg_match('/^[\x20-\x7E]*$/', $value)) {
        return str_replace(["\r", "\n"], '', $value);
    }
    return '=?UTF-8?B?' . base64_encode($value) . '?=';
}

function normalize_newlines(string $value): string
{
    return preg_replace("/\r\n|\r|\n/", "\r\n", $value);
}

function summarize(string $value): string
{
    $summary = preg_replace('/\s+/', ' ', $value);
    return substr(trim((string)$summary), 0, 180);
}

function json_response_headers(): void
{
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
}

function json_response(array $payload, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
