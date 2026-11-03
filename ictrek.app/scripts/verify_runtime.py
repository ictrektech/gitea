#!/usr/bin/env python3
"""Exercise a candidate image on an isolated Docker network with disposable VOS identities."""
import argparse
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import uuid


def docker(*args):
    return subprocess.check_output(['docker', *args], text=True, stderr=subprocess.STDOUT).strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', required=True)
    parser.add_argument('--postgres-image', required=True)
    parser.add_argument('--keep', action='store_true', help='Keep isolated containers for local SSH/runner validation')
    args = parser.parse_args()
    root = Path.home() / 'dev/build/gitea'
    root.mkdir(parents=True, exist_ok=True)
    storage = Path(tempfile.mkdtemp(prefix='runtime-', dir=root))
    for directory in ['data', 'config', 'context', 'postgres']:
        (storage / directory).mkdir()
    (storage / 'context/access-token').write_text('runtime-service-token')
    (storage / 'context/access-token').chmod(0o600)
    suffix = uuid.uuid4().hex[:10]
    network, info, app, postgres = [f'gitea-vos-{name}-{suffix}' for name in ['test', 'info', 'app', 'pgv']]
    mock = r'''
const http=require('node:http');let overrides={};
http.createServer(async(req,res)=>{
 if(req.url==='/control'){let body='';for await(const chunk of req)body+=chunk;overrides={...overrides,...JSON.parse(body)};res.end('{}');return;}
 if(req.url.startsWith('/user/list')){
 const id=new URL(req.url,'http://mock').searchParams.get('user_id');
 if(req.headers.authorization!=='Bearer runtime-service-token'){res.writeHead(401);res.end('{}');return;}
 const profile={id,username:id,nickname:id,enable:1,delete:0,role_code:id==='admin'?'system_admin':'user',...overrides[id]};
 res.setHeader('content-type','application/json');res.end(JSON.stringify({code:0,data:{data:['alice','bob','admin'].includes(id)?[profile]:[]}}));return;
}
const token=(req.headers.authorization||'').replace('Bearer ','');
 if(!['alice','bob','admin'].includes(token)){res.writeHead(401);res.end('{}');return;}
 res.setHeader('content-type','application/json');res.end(JSON.stringify({sub:token,preferred_username:token,nickname:token,email:'',enable:1,role_code:token==='admin'?'system_admin':'user',...overrides[token]}));
}).listen(8090,'0.0.0.0');
'''
    def address(name, port):
        mapping = json.loads(docker('inspect', name))[0]['NetworkSettings']['Ports'][f'{port}/tcp'][0]
        return 'http://127.0.0.1:' + mapping['HostPort']

    def request(base, path, token=None, payload=None, cookie=None, origin=None, native=None):
        headers = {}
        if native:
            headers['Authorization'] = 'token ' + native
        if token:
            headers['Authorization'] = 'Bearer ' + token
        if cookie:
            headers['Cookie'] = cookie
        if origin:
            headers['Origin'] = origin
        data = None
        if payload is not None:
            data = json.dumps(payload).encode()
            headers['Content-Type'] = 'application/json'
        try:
            with urlopen(Request(base + path, data=data, headers=headers), timeout=20) as response:
                return response.status, response.read(), response.headers
        except HTTPError as error:
            return error.code, error.read(), error.headers

    keep_success = False
    try:
        docker('network', 'create', network)
        docker('run', '-d', '--name', info, '--network', network, '-p', '127.0.0.1::8090', '--entrypoint', 'node', args.image, '-e', mock)
        docker('run', '-d', '--name', postgres, '--network', network, '--network-alias', 'pgv',
               '-e', 'POSTGRES_PASSWORD=runtime-postgres-password', '-e', 'PGDATA=/var/lib/postgresql/data/pgdata',
               '-v', f'{storage}/postgres:/var/lib/postgresql/data', args.postgres_image)
        for _ in range(90):
            try:
                docker('exec', postgres, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres')
                break
            except subprocess.CalledProcessError:
                time.sleep(1)
        else:
            raise AssertionError('PGV test database did not become ready')
        docker('run', '-d', '--name', app, '--network', network, '-p', '127.0.0.1::8080',
               '-e', f'VOS_USERINFO_URL=http://{info}:8090/userinfo', '-e', f'VOS_USERS_URL=http://{info}:8090/user/list',
               '-e', 'VOS_POSTGRES_PASSWORD=runtime-postgres-password',
               '-e', f'GITEA_PUBLIC_URL=http://{app}:8080/app/com.ictrek.gitea/',
               '-p', '127.0.0.1::2222', '-v', f'{storage}/context:/var/lib/vos-context:ro',
               '-v', f'{storage}/data:/data', '-v', f'{storage}/config:/config', args.image)
        host, info_host = address(app, 8080), address(info, 8090)
        base = host + '/app/com.ictrek.gitea'

        def ready():
            for _ in range(90):
                try:
                    if request(host, '/healthz')[0] == 200:
                        return
                except OSError:
                    pass
                time.sleep(1)
            raise AssertionError('Gitea did not become ready')

        ready()
        assert request(base, '/api/v1/user')[0] == 401
        identities = {}
        for token in ['alice', 'bob', 'admin']:
            code, data, _ = request(base, '/api/v1/user', token)
            assert code == 200, (token, code, data[:200])
            identities[token] = json.loads(data)
            assert identities[token]['is_admin'] == (token == 'admin')
        assert len({u['id'] for u in identities.values()}) == 3
        code, data, _ = request(base, '/user/sign_up', 'alice')
        assert code == 403
        code, data, headers = request(base, '/vos/login', payload={'access_token': 'alice', 'locale': 'zh-CN'}, origin=host)
        assert code == 200
        cookie = headers['Set-Cookie'].split(';')[0]
        code, html, _ = request(base, '/', cookie=cookie)
        assert code == 200 and b'lang="zh-CN"' in html and b'/vos/bridge.js' in html
        code, data, _ = request(base, '/api/v1/user', cookie=cookie)
        assert code == 200 and json.loads(data)['language'] == 'zh-CN'
        assert request(base, '/integration-guide', cookie=cookie)[0] == 200
        code, repo, _ = request(base, '/api/v1/user/repos', 'alice', {'name': 'vos-private-proof', 'private': True, 'auto_init': True})
        assert code == 201, (code, repo[:300])
        owner = identities['alice']['login']
        path = f'/api/v1/repos/{owner}/vos-private-proof'
        assert request(base, path, 'bob')[0] == 404
        assert request(base, path, 'admin')[0] == 200
        request(info_host, '/control', payload={'admin': {'role_code': 'user'}})
        code, data, _ = request(base, '/api/v1/user', 'admin')
        assert code == 200 and not json.loads(data)['is_admin'], 'Last-admin guard must not override VOS role changes'
        request(info_host, '/control', payload={'alice': {'nickname': 'Renamed VOS user'}})
        code, data, _ = request(base, '/api/v1/user', 'alice')
        renamed = json.loads(data)
        assert renamed['id'] == identities['alice']['id'] and renamed['full_name'] == 'Renamed VOS user'
        native_pat = docker('exec', '--user', 'node', app, '/usr/local/bin/gitea', '--work-path', '/data/gitea', '--custom-path', '/config', '--config', '/config/conf/app.ini', 'admin', 'user', 'generate-access-token', '--username', owner, '--token-name', 'native-proof', '--scopes', 'all', '--raw').splitlines()[-1]
        assert request(base, '/api/v1/user', native=native_pat)[0] == 200
        request(info_host, '/control', payload={'alice': {'enable': 0}})
        assert request(base, '/api/v1/user', 'alice')[0] == 401
        assert request(base, '/api/v1/user', native=native_pat)[0] == 401
        assert request(base, '/api/v1/user', cookie=cookie)[0] == 401
        request(info_host, '/control', payload={'alice': {'enable': 1}})
        assert request(base, '/api/v1/user', cookie=cookie)[0] == 401
        docker('restart', app)
        host = address(app, 8080)
        base = host + '/app/com.ictrek.gitea'
        ready()
        code, data, _ = request(base, path, 'alice')
        assert code == 200 and json.loads(data)['name'] == 'vos-private-proof'
        assert not (storage / 'data/gitea/gitea.db').exists()
        assert docker('exec', postgres, 'psql', '-U', 'postgres', '-Atq', '-c', "SELECT datname FROM pg_database WHERE datname='gitea'") == 'gitea'
        assert any((storage / 'data/git/repositories').glob('*/*.git'))
        assert (storage / 'config/conf/secrets.json').is_file()
        assert docker('exec', '--user', 'node', app, 'stat', '-c', '%a', '/config/ssh/gitea.ed25519') == '600'
        ssh_port = int(address(app, 2222).rsplit(':', 1)[1])
        with socket.create_connection(('127.0.0.1', ssh_port), timeout=5) as ssh_client:
            assert ssh_client.recv(128).startswith(b'SSH-2.0-')
        if args.keep:
            proof = {'app': app, 'info': info, 'network': network, 'postgres': postgres, 'image': args.image, 'storage': str(storage), 'http': host, 'userinfo': info_host, 'ssh': address(app, 2222), 'owner': owner}
            proof_path = root / 'runtime-proof.json'
            proof_path.write_text(json.dumps(proof))
            proof_path.chmod(0o600)
            keep_success = True
        print('PASS: JIT users, roles/demotion, identity isolation, private repositories, language, guide, native PAT revocation, PGV database and restart persistence')
    except Exception:
        logs = docker('logs', app)
        (root / 'runtime-failure.log').write_text(logs)
        print('Runtime failed; diagnostic log: ' + str(root / 'runtime-failure.log'))
        raise
    finally:
        if not keep_success:
            for name in [app, info, postgres]:
                subprocess.run(['docker', 'rm', '-f', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            subprocess.run(['docker', 'network', 'rm', network], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            # Image writes as UID 1000; remove only this run's disposable data through Docker.
            subprocess.run(['docker', 'run', '--rm', '--entrypoint', 'sh', '-v', f'{storage}:/proof', args.image,
                            '-c', 'rm -rf /proof/data /proof/config /proof/postgres'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            shutil.rmtree(storage, ignore_errors=True)


if __name__ == '__main__':
    main()
