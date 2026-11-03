#!/usr/bin/env python3
"""Run locally against an isolated --keep runtime proof; Git operations stay local."""
import argparse
import base64
import json
from pathlib import Path
import shlex
import socket
import subprocess
import tempfile
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def ssh(host, script):
    result = subprocess.run(['ssh', host, 'bash', '-s'], input=script, text=True, capture_output=True, check=True)
    return result.stdout.strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', required=True)
    args = parser.parse_args()
    proof = json.loads(ssh(args.host, 'cat "$HOME/dev/build/gitea/runtime-proof.json"'))
    root = Path.home() / 'dev/build/gitea'
    root.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix='ssh-actions-', dir=root))
    local_ports = []
    for _ in range(3):
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            local_ports.append(listener.getsockname()[1])
    forwards = []
    for local, remote in zip(local_ports, [proof['http'], proof['userinfo'], proof['ssh']]):
        forwards += ['-L', f'127.0.0.1:{local}:127.0.0.1:{remote.rsplit(":", 1)[1]}']
    tunnel = subprocess.Popen(['ssh', '-N', '-o', 'ExitOnForwardFailure=yes', *forwards, args.host], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    origin = f'http://127.0.0.1:{local_ports[0]}'
    base = origin + '/app/com.ictrek.gitea'
    info = f'http://127.0.0.1:{local_ports[1]}'
    owner = proof['owner']
    repo = f'/api/v1/repos/{owner}/vos-private-proof'
    runner_name = proof['app'] + '-runner'

    def request(path, payload=None, method=None, target=base):
        headers = {'Authorization': 'Bearer alice'}
        data = None
        if payload is not None:
            headers['Content-Type'] = 'application/json'
            data = json.dumps(payload).encode()
        try:
            with urlopen(Request(target + path, data=data, headers=headers, method=method), timeout=15) as response:
                body = response.read()
                return response.status, json.loads(body) if body else None
        except HTTPError as error:
            return error.code, None

    def git(*command, check=True):
        return subprocess.run(['git', '-c', 'core.sshCommand=' + ssh_command, *command], text=True, capture_output=True, check=check)

    try:
        for _ in range(30):
            try:
                if request('/api/v1/user')[0] == 200:
                    break
            except OSError:
                pass
            time.sleep(0.5)
        else:
            raise AssertionError('Tunnel did not become ready')
        key = work / 'proof-key'
        subprocess.run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(key)], check=True, capture_output=True)
        code, _ = request('/api/v1/user/keys', {'title': 'vos-native-proof', 'key': key.with_suffix('.pub').read_text()})
        assert code == 201, f'SSH key creation failed ({code})'
        ssh_command = shlex.join(['ssh', '-i', str(key), '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', f'UserKnownHostsFile={work}/known_hosts', '-p', str(local_ports[2])])
        clone_url = f'ssh://git@127.0.0.1:{local_ports[2]}/{owner}/vos-private-proof.git'
        checkout = work / 'repository'
        git('clone', clone_url, str(checkout))
        (checkout / 'ssh-proof.txt').write_text('VOS SSH clone and push verified\n')
        git('-C', str(checkout), 'add', 'ssh-proof.txt')
        git('-C', str(checkout), '-c', 'user.name=VOS Proof', '-c', 'user.email=proof@vos.invalid', 'commit', '-m', 'test: SSH round trip')
        git('-C', str(checkout), 'push')
        code, content = request(repo + '/contents/ssh-proof.txt')
        assert code == 200 and base64.b64decode(content['content']).startswith(b'VOS SSH')
        request('/control', {'alice': {'enable': 0}}, target=info)
        assert git('ls-remote', clone_url, check=False).returncode != 0, 'Disabled VOS user retained SSH access'
        request('/control', {'alice': {'enable': 1}}, target=info)
        git('ls-remote', clone_url)
        print('PASS: native SSH clone/push and VOS disable/re-enable', flush=True)
        code, _ = request(repo, {'has_actions': True}, method='PATCH')
        assert code == 200
        code, registration = request(repo + '/actions/runners/registration-token', {})
        assert code == 200, f'Runner registration token failed ({code})'
        runner_payload = {'token': registration['token'], 'proof': proof, 'name': runner_name}
        remote_script = '''import json, pathlib, subprocess, sys
p=json.load(sys.stdin)
root=pathlib.Path(p['proof']['storage'])
env=root/'runner.env'
env.write_text('GITEA_INSTANCE_URL=http://'+p['proof']['app']+':8080/app/com.ictrek.gitea/\\nGITEA_RUNNER_REGISTRATION_TOKEN='+p['token']+'\\nGITEA_RUNNER_NAME=vos-proof\\nGITEA_RUNNER_LABELS=vos-proof:host\\n')
env.chmod(0o600)
(root/'runner').mkdir(exist_ok=True)
subprocess.run(['docker','run','-d','--name',p['name'],'--network',p['proof']['network'],'--env-file',str(env),'-v',str(root/'runner')+':/data','docker.m.daocloud.io/gitea/runner:5'],check=True,stdout=subprocess.DEVNULL)
'''
        subprocess.run(['ssh', args.host, 'python3 -c ' + shlex.quote(remote_script)], input=json.dumps(runner_payload), text=True, capture_output=True, check=True)
        workflow = checkout / '.gitea/workflows/vos-proof.yml'
        workflow.parent.mkdir(parents=True, exist_ok=True)
        workflow.write_text("name: VOS native runner proof\non: [push, workflow_dispatch]\njobs:\n  proof:\n    runs-on: vos-proof\n    steps:\n      - uses: builtin:checkout\n      - run: test -f ssh-proof.txt && echo 'VOS runner job completed'\n")
        git('-C', str(checkout), 'add', '.gitea/workflows/vos-proof.yml')
        git('-C', str(checkout), '-c', 'user.name=VOS Proof', '-c', 'user.email=proof@vos.invalid', 'commit', '-m', 'test: native Actions execution')
        git('-C', str(checkout), 'push')
        for _ in range(150):
            code, runs = request(repo + '/actions/runs')
            assert code == 200
            rows = runs.get('workflow_runs', [])
            if rows and rows[0].get('conclusion') == 'success':
                print('PASS: native runner registration, polling and workflow execution', flush=True)
                break
            if rows and rows[0].get('conclusion') in ['failure', 'cancelled']:
                raise AssertionError('Native runner workflow did not succeed')
            time.sleep(1)
        else:
            raise AssertionError('Native runner workflow timed out')
    finally:
        tunnel.terminate()
        tunnel.wait(timeout=10)
        # Keep diagnostics and the disposable proof until the caller cleans it up.
        print('Local proof files: ' + str(work))


if __name__ == '__main__':
    main()
