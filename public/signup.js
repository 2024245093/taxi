async function signup() {
    const id = document.getElementById("signupId").value;
    const pw = document.getElementById("signupPw").value;
    const phone = document.getElementById("signupPhone").value;
    const captainName = document.getElementById("signupCaptain").value

    if (!id || !pw || !phone) {
        alert("모든 값을 입력하세요");
        return;
    }
    if (!/^[0-3] [가-힣]+\d?$/.test(id)) {
        alert("아이디 형식이 올바르지 않습니다");
        return;
    }
    if (!/^010\d{8}$/.test(phone)) {
        alert("전화번호 형식이 올바르지 않습니다");
        return;
    }

    try {
        const res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: id, password: pw, phone: phone, captainName: captainName.trim() })
        });
        const data = await res.json();

        if (res.ok) {
            alert("회원가입 성공!");
            location.href = "login.html";
        } else {
            alert(data.error);
        }
    } catch (err) {
        alert("서버 연결 오류가 발생했습니다.");
    }
}
