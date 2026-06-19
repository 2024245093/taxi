async function login() {
    const id = document.getElementById("loginId").value;
    const pw = document.getElementById("loginPw").value;
    const result = document.getElementById("result");

    if (!id || !pw) {
        result.innerText = "아이디와 비밀번호를 입력하세요.";
        return;
    }

    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: id, password: pw })
        });
        const data = await res.json();

        if (res.ok) {
            alert("로그인 성공 !");
            location.href = "index.html";
        } else {
            result.innerText = data.error;
        }
    } catch (err) {
        result.innerText = "서버 연결 오류가 발생했습니다.";
    }
}
