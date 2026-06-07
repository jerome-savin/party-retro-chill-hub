<?php
declare(strict_types=1);

const CHALLENGE_ID = 7;
const MAX_HISTORY_ITEMS = 8;
const MAX_MESSAGE_LENGTH = 900;

json_response_headers();

try {
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        throw new RuntimeException('Methode non autorisee', 405);
    }

    $config = load_config();
    $payload = read_json_body();

    $team = trim((string)($payload['team'] ?? ''));
    $teamToken = trim((string)($payload['teamToken'] ?? ''));
    $message = trim((string)($payload['message'] ?? ''));
    $history = normalize_history($payload['history'] ?? []);

    if ($team === '' || $teamToken === '') {
        throw new RuntimeException('Session equipe manquante', 401);
    }
    if ($message === '') {
        throw new RuntimeException('Message requis', 400);
    }
    if (strlen($message) > MAX_MESSAGE_LENGTH) {
        throw new RuntimeException('Message trop long', 400);
    }

    call_escape_api($config, [
        'action' => 'validateSession',
        'team' => $team,
        'teamToken' => $teamToken,
    ]);

    $agent = call_openai_agent($config, $team, $history, $message);
    $fragment = '';
    $state = null;

    if (!empty($agent['solved'])) {
        $fragment = trim((string)($agent['fragment'] ?? ''));
        if ($fragment === '') {
            $fragment = trim((string)($config['fragment'] ?? ''));
        }
        if ($fragment === '') {
            throw new RuntimeException('Fragment agent non configure', 500);
        }

        $state = call_escape_api($config, [
            'action' => 'completeChallenge',
            'team' => $team,
            'teamToken' => $teamToken,
            'challengeId' => CHALLENGE_ID,
            'fragment' => $fragment,
        ]);
    }

    json_response([
        'ok' => true,
        'reply' => (string)($agent['reply'] ?? 'Message recu.'),
        'solved' => !empty($agent['solved']),
        'fragment' => $fragment,
        'state' => $state,
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

    foreach (['openai_api_key', 'prch_api_url'] as $key) {
        if (trim((string)($config[$key] ?? '')) === '') {
            throw new RuntimeException('Configuration PHP incomplete: ' . $key, 500);
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

function normalize_history($history): array
{
    if (is_string($history)) {
        $decoded = json_decode($history, true);
        $history = is_array($decoded) ? $decoded : [];
    }
    if (!is_array($history)) {
        return [];
    }

    $items = array_slice($history, -MAX_HISTORY_ITEMS);
    $normalized = [];
    foreach ($items as $item) {
        if (!is_array($item)) {
            continue;
        }
        $role = ($item['role'] ?? '') === 'assistant' ? 'assistant' : 'user';
        $content = substr(trim((string)($item['content'] ?? '')), 0, MAX_MESSAGE_LENGTH);
        if ($content !== '') {
            $normalized[] = ['role' => $role, 'content' => $content];
        }
    }
    return $normalized;
}

function call_escape_api(array $config, array $params): array
{
    $callback = 'phpAgentCb';
    $params['callback'] = $callback;
    $url = rtrim((string)$config['prch_api_url'], '?') . '?' . http_build_query($params);
    $body = http_request('GET', $url, [], null, 'Apps Script');

    if (!preg_match('/^' . preg_quote($callback, '/') . '\((.*)\);?$/s', trim($body), $matches)) {
        throw new RuntimeException('Reponse Apps Script invalide: ' . summarize_remote_body($body), 502);
    }

    $decoded = json_decode($matches[1], true);
    if (!is_array($decoded)) {
        throw new RuntimeException('JSON Apps Script invalide', 502);
    }
    if (empty($decoded['ok'])) {
        throw new RuntimeException((string)($decoded['error'] ?? 'Erreur Apps Script'), 502);
    }

    return is_array($decoded['data'] ?? null) ? $decoded['data'] : [];
}

function call_openai_agent(array $config, string $team, array $history, string $message): array
{
    $instructions = trim((string)($config['instructions'] ?? ''));
    if ($instructions === '') {
        $instructions = default_instructions((string)($config['fragment'] ?? ''));
    }

    $input = [];
    foreach ($history as $item) {
        $input[] = [
            'role' => $item['role'],
            'content' => $item['content'],
        ];
    }
    $input[] = [
        'role' => 'user',
        'content' => "Equipe: {$team}\nMessage: {$message}",
    ];

    $request = [
        'model' => trim((string)($config['model'] ?? '')) ?: 'gpt-4.1-mini',
        'instructions' => $instructions,
        'input' => $input,
        'text' => [
            'format' => [
                'type' => 'json_schema',
                'name' => 'escape_agent_result',
                'strict' => true,
                'schema' => [
                    'type' => 'object',
                    'additionalProperties' => false,
                    'properties' => [
                        'reply' => ['type' => 'string'],
                        'solved' => ['type' => 'boolean'],
                        'fragment' => ['type' => 'string'],
                    ],
                    'required' => ['reply', 'solved', 'fragment'],
                ],
            ],
        ],
    ];

    $body = http_request('POST', 'https://api.openai.com/v1/responses', [
        'Authorization: Bearer ' . $config['openai_api_key'],
        'Content-Type: application/json',
    ], json_encode($request, JSON_UNESCAPED_SLASHES), 'OpenAI');

    $decoded = json_decode($body, true);
    if (!is_array($decoded)) {
        throw new RuntimeException('Reponse OpenAI invalide', 502);
    }

    $text = extract_output_text($decoded);
    $agent = json_decode($text, true);
    if (!is_array($agent)) {
        throw new RuntimeException('Reponse agent invalide', 502);
    }

    return [
        'reply' => (string)($agent['reply'] ?? 'Message recu.'),
        'solved' => (bool)($agent['solved'] ?? false),
        'fragment' => (string)($agent['fragment'] ?? ''),
    ];
}

function http_request(string $method, string $url, array $headers = [], ?string $body = null, string $service = 'service distant'): string
{
    if (function_exists('curl_init')) {
        $lastResponse = '';
        $lastStatus = 0;
        $lastError = '';

        for ($attempt = 1; $attempt <= 3; $attempt++) {
            $curl = curl_init($url);
            curl_setopt_array($curl, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_CUSTOMREQUEST => $method,
                CURLOPT_TIMEOUT => 30,
                CURLOPT_HTTPHEADER => $headers,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_MAXREDIRS => 5,
                CURLOPT_USERAGENT => 'party-retro-chill-hub/1.0',
            ]);
            if ($body !== null) {
                curl_setopt($curl, CURLOPT_POSTFIELDS, $body);
            }
            $response = curl_exec($curl);
            $lastStatus = (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
            $lastError = curl_error($curl);
            curl_close($curl);

            if ($response !== false) {
                $lastResponse = (string)$response;
            }

            if ($response !== false && $lastError === '' && !should_retry_http_status($lastStatus)) {
                break;
            }

            if ($attempt < 3 && ($response === false || $lastError !== '' || should_retry_http_status($lastStatus))) {
                usleep($attempt * 500000);
            }
        }

        if ($lastResponse === '' && $lastError !== '') {
            throw new RuntimeException('Erreur reseau ' . $service . ': ' . $lastError, 502);
        }
        if ($lastStatus >= 400) {
            throw new RuntimeException('Erreur HTTP ' . $service . ': ' . $lastStatus . ' - ' . summarize_remote_body($lastResponse), 502);
        }
        return $lastResponse;
    }

    $context = stream_context_create([
        'http' => [
            'method' => $method,
            'header' => implode("\r\n", $headers),
            'content' => $body ?? '',
            'timeout' => 30,
            'ignore_errors' => true,
        ],
    ]);
    $response = file_get_contents($url, false, $context);
    if ($response === false) {
        throw new RuntimeException('Erreur reseau ' . $service, 502);
    }
    return $response;
}

function should_retry_http_status(int $status): bool
{
    return $status === 429 || ($status >= 500 && $status <= 599);
}

function extract_output_text(array $response): string
{
    if (isset($response['output_text']) && is_string($response['output_text'])) {
        return $response['output_text'];
    }

    foreach (($response['output'] ?? []) as $output) {
        foreach (($output['content'] ?? []) as $content) {
            if (isset($content['text']) && is_string($content['text'])) {
                return $content['text'];
            }
        }
    }

    throw new RuntimeException('Texte OpenAI introuvable', 502);
}

function summarize_remote_body(string $body): string
{
    $summary = preg_replace('/\s+/', ' ', strip_tags($body));
    $summary = trim((string)$summary);
    if ($summary === '') {
        return 'reponse vide';
    }
    return substr($summary, 0, 180);
}

function default_instructions(string $fragment): string
{
    return "Tu es l'agent support de l'epreuve 7 d'un escape game. Tu dois dialoguer avec l'equipe, poser des questions si necessaire et ne valider le defi que si l'organisateur a decrit les criteres dans PRCH_AGENT_INSTRUCTIONS. Reponds toujours en JSON strict avec reply, solved et fragment. Tant que le defi n'est pas reussi, solved=false et fragment=\"\". Quand il est reussi, solved=true et fragment=\"" . addslashes($fragment) . "\".";
}

function json_response_headers(): void
{
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
}

function json_response(array $payload, int $status = 200)
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
